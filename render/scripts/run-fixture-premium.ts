// Run a FROZEN fixture through the real premium path, end to end, with no DB/storage.
//
// Why this exists: test-local.ts hardcodes a stub brief (empty script, no scenes) and never sets
// editMode, so job.ts:147 falls back to "brief-driven" and the premium pipeline never runs at all.
// This runner loads a frozen {videoUrls, brief} fixture and forces "generated-experimental" so the
// storyboard -> author -> render -> vision-QA loop is actually exercised.
//
// Usage: npx tsx scripts/run-fixture-premium.ts <path-to-fixture.json> [jobLabel]
import { readFile } from "node:fs/promises";
import { runJob } from "../src/job.js";
import type { RenderBrief } from "../src/types.js";

const fixturePath = process.argv[2];
const label = process.argv[3] || "fixture";

if (!fixturePath) {
  console.error("usage: npx tsx scripts/run-fixture-premium.ts <path-to-fixture.json> [jobLabel]");
  process.exit(1);
}

interface Fixture {
  videoUrls: string[];
  brief: RenderBrief;
}

async function main() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
  const assetCount = fixture.brief.assets?.images?.length ?? 0;

  console.log(`\n=== premium fixture run (${label}) ===`);
  console.log(`fixture   : ${fixturePath}`);
  console.log(`clips     : ${fixture.videoUrls.length}`);
  console.log(`scenes    : ${fixture.brief.scenes?.length ?? 0}`);
  console.log(`assets    : ${assetCount}${assetCount === 0 ? "  <- zero-asset input (the frozen before-run condition)" : ""}`);
  console.log(`editMode  : generated-experimental (forced)\n`);

  const started = Date.now();
  const result = await runJob(
    label,
    {
      videoUrls: fixture.videoUrls,
      brief: fixture.brief,
      editMode: "generated-experimental",
    },
    (status, extra) => {
      const at = ((Date.now() - started) / 1000).toFixed(1).padStart(6);
      console.log(`  [${at}s] ${status}${extra?.mp4Url ? " -> " + extra.mp4Url : ""}`);
    },
  );

  console.log(`\n=== done in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min ===`);
  console.log(`  segments kept : ${result.segments}`);
  console.log(`  duration      : ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`  output        : ${result.localPath}`);
}

main().catch((e) => {
  console.error("\nrun-fixture-premium FAILED:", e);
  process.exit(1);
});
