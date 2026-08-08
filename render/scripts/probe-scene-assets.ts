/**
 * Single-scene probe WITH the brief's real assets, so you can look at the output.
 *
 * `probe-scene.ts` deliberately freezes assetHints to [] to isolate the author/QA contract. That
 * makes it useless for the question "did the user's screenshots actually reach a scene", which is
 * the thing that silently broke: the pinned DNS lookup rejected every download, the engine fell
 * back to generic overlays, and nothing failed loudly.
 *
 * This variant downloads `brief.assets.images` through the real `fetchAssetBytes` path, hands the
 * filenames to the planner as hints, renders one scene, and leaves the artifacts on disk.
 *
 *   npx tsx scripts/probe-scene-assets.ts <base.mp4> <captions.mov> <props.json> <fixture.json> [sceneIndex]
 */
import { mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { planEdit } from "../src/premium/scenes.js";
import { produceScene } from "../src/premium/index.js";
import { fetchAssetBytes } from "../src/premium/asset-source.js";
import type { RenderBrief, Word } from "../src/types.js";

const [baseArg, capsArg, propsArg, fixtureArg, idxArg] = process.argv.slice(2);
if (!baseArg || !capsArg || !propsArg || !fixtureArg) {
  console.error(
    "usage: npx tsx scripts/probe-scene-assets.ts <base.mp4> <captions.mov> <props.json> <fixture.json> [sceneIndex]",
  );
  process.exit(1);
}
const sceneIndex = Number(idxArg ?? 0);

// allowedAssetHosts() reads process.env; load render/.env when it is not already set.
if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    const text = await readFile(join(import.meta.dirname, "..", ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL|OPENAI_API_KEY)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fall through */
  }
}

const basePath = resolve(baseArg);
const captionOverlayPath = resolve(capsArg);
const props = JSON.parse(await readFile(propsArg, "utf8")) as { words: Word[]; durationMs: number };
const { brief } = JSON.parse(await readFile(fixtureArg, "utf8")) as { brief: RenderBrief };

const premiumDir = join(process.cwd(), "tmp", `probe-assets-${sceneIndex}`);
await rm(premiumDir, { recursive: true, force: true });
const assetsDir = join(premiumDir, "assets");
await mkdir(assetsDir, { recursive: true });

console.log("=== scene probe WITH assets ===");

// 1. Download through the real guarded path. This is the step that used to fail for everything.
const sources = brief.assets?.images ?? [];
const assetHints: string[] = [];
console.log(`\ndownloading ${sources.length} asset(s)`);
for (const src of sources) {
  const name = (src.split("/").pop() ?? "asset").replace(/[^a-zA-Z0-9.]+/g, "-");
  try {
    const bytes = await fetchAssetBytes(src);
    await writeFile(join(assetsDir, name), bytes);
    assetHints.push(name);
    console.log(`  ok      ${name.padEnd(24)} ${(bytes.length / 1e6).toFixed(2)} MB`);
  } catch (err) {
    console.log(`  FAILED  ${name.padEnd(24)} ${err instanceof Error ? err.message : String(err)}`);
  }
}
if (!assetHints.length) {
  console.error("\nno assets downloaded, so there is nothing to prove. stopping.");
  process.exit(1);
}

// 2. Plan with the hints, so the author is actually told to embed them.
const editPlan = await planEdit({
  brief,
  words: props.words,
  durationMs: props.durationMs,
  assetHints,
});
const specs = editPlan.scenes;
console.log(`\nplanned : ${specs.length} scenes, ${assetHints.length} assets`);
if (!specs.length) throw new Error("planEdit produced no enhanced scenes");

// planEdit is a model call, so "scene 2" is not the same beat between runs. Passing a keyword
// instead of an index picks the first beat whose intent actually calls for the product shots.
// Selecting by index otherwise lands on a motion-graphics beat that legitimately embeds nothing,
// which looks like a broken asset pipeline when it is just the wrong scene.
const selector = idxArg && Number.isNaN(Number(idxArg)) ? idxArg.toLowerCase() : null;
const matched = selector ? specs.find((s) => s.intent.toLowerCase().includes(selector)) : undefined;
if (selector && !matched) {
  console.error(`no scene intent mentions "${selector}". intents were:`);
  specs.forEach((s, i) => console.error(`  [${i}] ${s.intent.slice(0, 120)}`));
  process.exit(1);
}
const spec = matched ?? specs[Math.min(sceneIndex, specs.length - 1)];
console.log(`probing : ${spec.id} (${spec.mode}) @ ${spec.anchorMs}ms for ${spec.durMs}ms`);
console.log(`intent  : ${spec.intent.slice(0, 200)}\n`);

const started = Date.now();
const result = await produceScene({
  spec,
  brief,
  creativeDirection: editPlan.creativeDirection,
  assetHints,
  assetsDir,
  premiumDir,
  basePath,
  captionOverlayPath,
  fps: 30,
  log: (m: string) => console.log(`  ${m}`),
});

console.log(`\ntook ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`verdict : ${result.report?.verdict ?? "(none)"}`);
console.log(`mov     : ${result.movPath ?? "(none)"}`);

// 3. Did the shipped HTML actually reference the real files?
// `html` on the result IS the shipped attempt; there is no per-attempt history on AuthoredScene
// (use the onAttempt callback if you need the earlier tries).
const html = result.html ?? "";
const embedded = assetHints.filter((n) => html.includes(n));
console.log(`\nassets referenced in the final HTML: ${embedded.length}/${assetHints.length}`);
for (const n of assetHints) console.log(`  ${html.includes(n) ? "embedded" : "absent  "}  ${n}`);

console.log(`\nartifacts under ${premiumDir}`);
for (const f of await readdir(premiumDir).catch(() => [])) console.log(`  ${f}`);
if (!embedded.length) process.exitCode = 1;
