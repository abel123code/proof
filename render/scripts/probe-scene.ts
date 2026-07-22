// Fast single-scene probe: author -> render -> vision-QA for ONE scene, reusing an EXISTING
// captioned base clip. Skips transcribe/cut/caption-render entirely.
//
// Full E2E is ~45 min because every QA rejection costs a Chromium render + composite + 5-frame
// extract + vision call (~2.6 min), and a rejected scene burns 3 of them. When the thing under
// test is the author/QA contract, that loop is the wrong tool: this runs one scene in ~2-3 min.
//
// Usage:
//   npx tsx scripts/probe-scene.ts <captioned.mp4> <props.json> <fixture.json> [sceneIndex]
//
// props.json supplies the real word timeline + duration (so anchors match production).
// fixture.json supplies the real brief. Frames + verdict land in render/tmp/probe-<n>/.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { planScenes } from "../src/premium/scenes.js";
import { produceScene } from "../src/premium/index.js";
import type { RenderBrief, Word } from "../src/types.js";

const [basePathArg, propsPathArg, fixturePathArg, sceneIndexArg] = process.argv.slice(2);

if (!basePathArg || !propsPathArg || !fixturePathArg) {
  console.error(
    "usage: npx tsx scripts/probe-scene.ts <captioned.mp4> <props.json> <fixture.json> [sceneIndex]",
  );
  process.exit(1);
}

const sceneIndex = Number(sceneIndexArg ?? 0);

async function main() {
  const basePath = resolve(basePathArg);
  const props = JSON.parse(await readFile(propsPathArg, "utf8")) as {
    words: Word[];
    durationMs: number;
  };
  const { brief } = JSON.parse(await readFile(fixturePathArg, "utf8")) as { brief: RenderBrief };

  const assetHints: string[] = []; // frozen zero-asset condition
  const specs = await planScenes({
    brief,
    words: props.words,
    durationMs: props.durationMs,
    assetHints,
  });

  console.log(`\n=== scene probe ===`);
  console.log(`base    : ${basePath}`);
  console.log(`planned : ${specs.length} scenes, ${assetHints.length} assets`);
  if (!specs.length) throw new Error("planScenes produced no scenes");

  const spec = specs[Math.min(sceneIndex, specs.length - 1)];
  console.log(`probing : ${spec.id} @ ${spec.anchorMs}ms for ${spec.durMs}ms`);
  console.log(`intent  : ${spec.intent.slice(0, 160)}...\n`);

  const premiumDir = join(process.cwd(), "tmp", `probe-${sceneIndex}`);
  const assetsDir = join(premiumDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const started = Date.now();
  const scene = await produceScene({
    spec,
    brief,
    assetHints,
    assetsDir,
    premiumDir,
    basePath,
    fps: 30,
    log: (m) => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s ${m}`),
  });

  const approved = Boolean(scene.movPath);
  await writeFile(
    join(premiumDir, "verdict.json"),
    JSON.stringify({ sceneId: spec.id, approved, movPath: scene.movPath ?? null, spec }, null, 2),
  );

  console.log(`\n=== ${approved ? "APPROVED" : "REJECTED"} in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min ===`);
  console.log(`  qa frames : ${premiumDir}/${spec.id}-frame-*.png`);
  console.log(`  composite : ${premiumDir}/${spec.id}-qa.mp4`);
  if (!approved) process.exitCode = 2;
}

main().catch((e) => {
  console.error("\nprobe-scene FAILED:", e);
  process.exit(1);
});
