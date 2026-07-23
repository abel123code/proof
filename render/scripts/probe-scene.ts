// Fast single-scene probe: author -> render -> vision-QA for ONE scene, reusing an EXISTING
// captioned base clip. Skips transcribe/cut/caption-render entirely.
//
// Full E2E is ~45 min because every QA rejection costs a Chromium render + composite + 5-frame
// extract + vision call (~2.6 min), and a rejected scene burns 3 of them. When the thing under
// test is the author/QA contract, that loop is the wrong tool: this runs one scene in ~2-3 min.
//
// Each RENDERED attempt is snapshotted to tmp/probe-<n>/attempt-<k>/ (index.html, scene.mov, the 5
// QA frames, hashes) and summarised in run.json — so patch-vs-reroll and the retry count are
// provable after the run, not overwritten.
//
// Usage:
//   npx tsx scripts/probe-scene.ts <captioned.mp4> <props.json> <fixture.json> [sceneIndex]
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { planScenes } from "../src/premium/scenes.js";
import { produceScene, type SceneAttemptRecord } from "../src/premium/index.js";
import type { RenderBrief, Word } from "../src/types.js";

const [basePathArg, propsPathArg, fixturePathArg, sceneIndexArg] = process.argv.slice(2);

if (!basePathArg || !propsPathArg || !fixturePathArg) {
  console.error("usage: npx tsx scripts/probe-scene.ts <captioned.mp4> <props.json> <fixture.json> [sceneIndex]");
  process.exit(1);
}

const sceneIndex = Number(sceneIndexArg ?? 0);
const sha12 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

async function main() {
  const basePath = resolve(basePathArg);
  const props = JSON.parse(await readFile(propsPathArg, "utf8")) as { words: Word[]; durationMs: number };
  const { brief } = JSON.parse(await readFile(fixturePathArg, "utf8")) as { brief: RenderBrief };

  const assetHints: string[] = []; // frozen zero-asset condition
  const specs = await planScenes({ brief, words: props.words, durationMs: props.durationMs, assetHints });

  console.log(`\n=== scene probe ===`);
  console.log(`base    : ${basePath}`);
  console.log(`planned : ${specs.length} scenes, ${assetHints.length} assets`);
  if (!specs.length) throw new Error("planScenes produced no scenes");

  const spec = specs[Math.min(sceneIndex, specs.length - 1)];
  console.log(`probing : ${spec.id} @ ${spec.anchorMs}ms for ${spec.durMs}ms`);
  console.log(`intent  : ${spec.intent.slice(0, 160)}...\n`);

  const premiumDir = join(process.cwd(), "tmp", `probe-${sceneIndex}`);
  await rm(premiumDir, { recursive: true, force: true }); // clear stale attempt-* dirs
  const assetsDir = join(premiumDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const started = Date.now();
  const attempts: Array<{
    attempt: number; iter: number; outcome: string; issues: string[]; htmlSha: string; movSha: string | null; frames: number;
  }> = [];

  const onAttempt = async (rec: SceneAttemptRecord) => {
    const n = attempts.length + 1;
    const dir = join(premiumDir, `attempt-${n}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), rec.html);
    const htmlSha = sha12(rec.html);
    let movSha: string | null = null;
    try {
      movSha = sha12(await readFile(rec.movPath));
      await copyFile(rec.movPath, join(dir, "scene.mov"));
    } catch {
      /* no mov (shouldn't happen post-render) */
    }
    let frames = 0;
    for (let k = 0; k < 5; k++) {
      try {
        await copyFile(join(premiumDir, `${spec.id}-frame-${k}.png`), join(dir, `frame-${k}.png`));
        frames++;
      } catch {
        /* caption_reject runs before QA extracts frames */
      }
    }
    attempts.push({ attempt: n, iter: rec.attempt, outcome: rec.outcome, issues: rec.issues, htmlSha, movSha, frames });
    console.log(`  [attempt ${n}] ${rec.outcome} — html ${htmlSha}, mov ${movSha ?? "n/a"}, ${frames} frames`);
  };

  const scene = await produceScene({
    spec, brief, assetHints, assetsDir, premiumDir, basePath, fps: 30,
    log: (m) => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s ${m}`),
    onAttempt,
  });

  const approved = Boolean(scene.movPath);
  const editorialEdits = attempts.filter((a) => a.outcome === "editorial_reject" || a.outcome === "caption_reject").length;
  await writeFile(
    join(premiumDir, "run.json"),
    JSON.stringify(
      { sceneId: spec.id, approved, movPath: scene.movPath ?? null, editorialEdits, attempts, spec, elapsedSec: (Date.now() - started) / 1000 },
      null,
      2,
    ),
  );

  console.log(`\n=== ${approved ? "APPROVED" : "OMITTED"} in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min (${attempts.length} rendered attempts, ${editorialEdits} edits) ===`);
  console.log(`  attempts  : ${premiumDir}/attempt-*/`);
  console.log(`  run.json  : ${premiumDir}/run.json`);
  if (!approved) process.exitCode = 2;
}

main().catch((e) => {
  console.error("\nprobe-scene FAILED:", e);
  process.exit(1);
});
