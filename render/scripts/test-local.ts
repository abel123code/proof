// End-to-end local render with NO DB/storage dependency: feed a local recording +
// a seeded brief through the full job, render an edited.mp4 to render/out/.
// This is the "it works" milestone. Run: npm run test:local [path-to-mp4]
import { randomUUID } from "node:crypto";
import { runJob } from "../src/job.js";
import type { RenderBrief } from "../src/types.js";

const SAMPLE =
  process.argv[2] ??
  "C:/Users/Abhis/OneDrive/Documents/SEO/lullaflex-site/hackathon/loom/out/final.mp4";

// Seeded brief stands in for the Exa/OpenAI half. Keyword flags that don't appear in the
// recording simply produce no overlay — captions + cut still prove the pipeline.
const brief: RenderBrief = {
  script: "",
  keywordFlags: [
    { phrase: "rankr" },
    { phrase: "SEO" },
    { phrase: "keyword" },
  ],
  overlays: [
    { type: "text-card", content: "auto-cut + captioned by proof", anchor: { kind: "ratio", at: 0.04 }, durationMs: 2200 },
  ],
};

async function main() {
  const jobId = randomUUID().slice(0, 8);
  console.log(`\n=== local render test (job ${jobId}) ===`);
  console.log(`input: ${SAMPLE}\n`);

  const result = await runJob(jobId, { videoUrl: SAMPLE, brief }, (status, extra) => {
    console.log(`  [${status}]${extra?.mp4Url ? " -> " + extra.mp4Url : ""}`);
  });

  console.log(`\n✓ done`);
  console.log(`  segments kept : ${result.segments}`);
  console.log(`  duration      : ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`  output        : ${result.localPath}`);
}

main().catch((e) => {
  console.error("\ntest-local FAILED:", e);
  process.exit(1);
});
