import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RenderBrief, Word, AuthoredScene, SceneSpec } from "../types.js";
import { planScenes } from "./scenes.js";
import { authorScene } from "./author.js";
import { qaScene } from "./qa.js";
import { composeScenes } from "./compose.js";
import { renderComposition, hyperframesAvailable } from "./hyperframes.js";

export { hyperframesAvailable };

const MAX_QA_ITERS = Number(process.env.PREMIUM_MAX_QA_ITERS || 2);

function safeAssetName(src: string, i: number): string {
  const raw = basename(src.split("?")[0]) || `asset-${i}`;
  const clean = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(clean) ? clean : `${clean}.png`;
}

async function fetchAsset(src: string, destPath: string): Promise<void> {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    await writeFile(destPath, Buffer.from(await res.arrayBuffer()));
  } else {
    await copyFile(src.replace(/^file:\/\//, ""), destPath);
  }
}

/**
 * Produce one scene: author -> render -> vision-QA, re-authoring against QA feedback up to
 * MAX_QA_ITERS times. Returns the scene with a movPath once approved (or accepted on the last
 * iteration). Throws on hard failure (author/render error) so the caller can skip this beat.
 */
async function produceScene(args: {
  spec: SceneSpec;
  brief: RenderBrief;
  assetHints: string[];
  assetsDir: string;
  premiumDir: string;
  basePath: string;
  fps: number;
  log: (m: string) => void;
}): Promise<AuthoredScene> {
  const { spec, brief, assetHints, assetsDir, premiumDir, basePath, fps, log } = args;

  // Each scene renders from its own dir; assets are copied in so `./assets/<name>` resolves.
  const sceneDir = join(premiumDir, spec.id);
  const sceneAssets = join(sceneDir, "assets");
  await mkdir(sceneAssets, { recursive: true });
  for (const name of assetHints) {
    await copyFile(join(assetsDir, name), join(sceneAssets, name)).catch(() => {});
  }

  const movPath = join(premiumDir, `${spec.id}.mov`);
  let issues: string[] | undefined;
  for (let iter = 0; iter <= MAX_QA_ITERS; iter++) {
    const html = await authorScene({ spec, brief, assetHints, priorIssues: issues });
    await renderComposition({ html, sceneDir, outMovPath: movPath, fps });
    const qa = await qaScene({ spec, movPath, basePath, workDir: premiumDir });
    if (qa.ok || iter === MAX_QA_ITERS) {
      log(`  ${spec.id}: ${qa.ok ? "approved" : `accepted after ${iter} retr${iter === 1 ? "y" : "ies"}`}`);
      return { spec, html, movPath };
    }
    issues = qa.issues;
    log(`  ${spec.id}: retry ${iter + 1} — ${qa.issues.slice(0, 2).join("; ")}`);
  }
  // Unreachable (loop returns), but keeps the type checker happy.
  return { spec, html: "", movPath };
}

/**
 * The premium render path: bespoke per-beat scenes (GPT storyboard -> HyperFrames HTML ->
 * vision-QA loop) composited onto the already-captioned base clip. Any hard failure throws so
 * job.ts can fall back to the fixed-component output (which is exactly `basePath`).
 */
export async function runPremium(args: {
  basePath: string; // the captioned base clip (fixed-component output = the fallback)
  outPath: string;
  brief: RenderBrief;
  words: Word[];
  durationMs: number;
  workDir: string;
  fps?: number;
  log?: (m: string) => void;
}): Promise<{ outPath: string; sceneCount: number }> {
  const { basePath, outPath, brief, words, durationMs, workDir } = args;
  const fps = args.fps ?? 30;
  const log = args.log ?? (() => {});

  if (!hyperframesAvailable()) throw new Error("hyperframes CLI not installed");

  const premiumDir = join(workDir, "premium");
  const assetsDir = join(premiumDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  // 1. Fetch the assets folder; hints are the filenames the author may reference.
  const assetHints: string[] = [];
  for (const [i, src] of (brief.assets?.images ?? []).entries()) {
    try {
      const name = safeAssetName(src, i);
      await fetchAsset(src, join(assetsDir, name));
      assetHints.push(name);
    } catch (e) {
      log(`premium: asset fetch failed (${src}): ${(e as Error).message}`);
    }
  }

  // 2. Storyboard.
  const specs = await planScenes({ brief, words, durationMs, assetHints });
  if (specs.length === 0) throw new Error("planScenes produced no scenes");
  log(`premium: ${specs.length} scenes planned, ${assetHints.length} assets`);

  // 3. Author -> render -> QA each scene (sequential to bound Chromium memory).
  const authored: AuthoredScene[] = [];
  for (const spec of specs) {
    try {
      authored.push(
        await produceScene({ spec, brief, assetHints, assetsDir, premiumDir, basePath, fps, log }),
      );
    } catch (e) {
      log(`premium: scene ${spec.id} failed, skipping — ${(e as Error).message}`);
      authored.push({ spec, html: "" }); // no movPath -> skipped in compose
    }
  }

  const rendered = authored.filter((s) => s.movPath).length;
  if (rendered === 0) throw new Error("premium: no scenes rendered");
  log(`premium: ${rendered}/${specs.length} scenes rendered`);

  // 4. Composite bespoke scenes over the captioned base.
  const sceneCount = await composeScenes(basePath, authored, outPath);
  return { outPath, sceneCount };
}
