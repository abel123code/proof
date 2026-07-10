// Remote test against a LIVE render service (e.g. on Zo): upload a local clip to a public
// Supabase bucket, POST it to <baseUrl>/render, poll until done/error.
// Usage: npm run test:zo -- <localClip> <baseUrl>
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { getSupabaseAdmin } from "../src/supabase.js";

const clip = process.argv[2];
const baseUrl = (process.argv[3] || "").replace(/\/$/, "");
if (!clip || !baseUrl) {
  console.error("usage: tsx scripts/test-zo.ts <localClip> <baseUrl>");
  process.exit(1);
}

const BUCKET = "proof-test";

async function publicUpload(path: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const key = `in/${Date.now()}-${basename(path)}`;
  const buf = await readFile(path);
  const up = await supabase.storage.from(BUCKET).upload(key, buf, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (up.error) throw new Error(`upload failed: ${up.error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("uploading clip to a public URL...");
  const videoUrl = await publicUpload(clip);
  console.log("public videoUrl:", videoUrl);

  const RENDER_TOKEN = process.env.RENDER_TOKEN;
  const body = { videoUrl, brief: { script: "", keywordFlags: [] } };
  console.log(`\nPOST ${baseUrl}/render`);
  const res = await fetch(`${baseUrl}/render`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(RENDER_TOKEN ? { "x-render-token": RENDER_TOKEN } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`render POST failed ${res.status}: ${await res.text()}`);
  const { jobId } = (await res.json()) as { jobId: string };
  console.log("jobId:", jobId, "\npolling...\n");

  let last = "";
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const s = await fetch(`${baseUrl}/render/${jobId}`, {
      headers: RENDER_TOKEN ? { "x-render-token": RENDER_TOKEN } : {},
    }).then((r) => r.json());
    if (s.status !== last) {
      console.log(`  [${s.status}]${s.error ? " " + s.error : ""}${s.mp4Url ? " -> " + s.mp4Url : ""}`);
      last = s.status;
    }
    if (s.status === "done") {
      console.log("\n✓ RENDER COMPLETED ON THE REMOTE BOX. mp4:", s.mp4Url);
      const dlUrl = `${baseUrl}/out/edited-${jobId}.mp4`;
      const r = await fetch(dlUrl);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        await writeFile("out/zo-result.mp4", buf);
        console.log(`downloaded -> out/zo-result.mp4 (${buf.length} bytes)`);
      } else {
        console.log(`(could not download from ${dlUrl}: ${r.status})`);
      }
      return;
    }
    if (s.status === "error") {
      console.log("\n✗ remote render errored:", s.error);
      process.exit(1);
    }
  }
  console.log("\n timed out waiting for the job");
  process.exit(1);
}

main().catch((e) => {
  console.error("test-zo FAILED:", e);
  process.exit(1);
});
