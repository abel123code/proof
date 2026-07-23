// Retest the improved premium loop (author -> render -> caption-check -> editorial QA -> patch)
// over an ALREADY-captioned frozen base, then composite the final MP4. Skips download/transcribe/
// cut/caption entirely (those are frozen in minfix), so this exercises ONLY the code that changed
// and is far cheaper/faster than a full E2E while still producing a complete before/after video.
//
// before = the captioned base (captions only, the old fallback when scenes were rejected)
// after  = this output (captioned base + approved bespoke scenes)
//
// Usage: npx tsx scripts/run-premium-frozen.ts <captioned.mp4> <props.json> <brief.json> <out.mp4>
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runPremium } from "../src/premium/index.js";
import type { RenderBrief, Word } from "../src/types.js";

const [baseArg, propsArg, briefArg, outArg] = process.argv.slice(2);

if (!baseArg || !propsArg || !briefArg || !outArg) {
  console.error("usage: npx tsx scripts/run-premium-frozen.ts <captioned.mp4> <props.json> <brief.json> <out.mp4>");
  process.exit(1);
}

async function main() {
  const basePath = resolve(baseArg);
  const props = JSON.parse(await readFile(propsArg, "utf8")) as { words: Word[]; durationMs: number };
  const brief = JSON.parse(await readFile(briefArg, "utf8")) as RenderBrief;
  const outPath = resolve(outArg);
  const workDir = join(process.cwd(), "tmp", "frozen-retest");

  const started = Date.now();
  const at = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(7)}s`;

  console.log(`\n=== premium retest over frozen captioned base ===`);
  console.log(`base   : ${basePath}`);
  console.log(`words  : ${props.words.length}, durationMs: ${props.durationMs}`);
  console.log(`out    : ${outPath}\n`);

  const r = await runPremium({
    basePath,
    outPath,
    brief,
    words: props.words,
    durationMs: props.durationMs,
    workDir,
    fps: 30,
    log: (m) => console.log(`${at()} ${m}`),
  });

  console.log(`\n=== done in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min — ${r.sceneCount} scene(s) composited ===`);
  console.log(`output    : ${r.outPath}`);
  console.log(`scenes dir: ${join(workDir, "premium")}`);

  // Auditable per-scene report — the "why" behind every scene, exactly what the app will surface.
  console.log(`\n=== per-scene audit (scene-report.json) ===`);
  for (const rep of r.reports) {
    const tag =
      rep.verdict === "clean" ? "CLEAN " : rep.verdict === "flagged" ? "FLAGGED" : "BASE   ";
    console.log(`  [${tag}] ${rep.sceneId} (${rep.attempts} attempt${rep.attempts === 1 ? "" : "s"})`);
    for (const i of rep.issues) console.log(`           - (${i.kind}) ${i.text}`);
  }
}

main().catch((e) => {
  console.error("\nrun-premium-frozen FAILED:", e);
  process.exit(1);
});
