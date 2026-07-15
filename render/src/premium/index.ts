import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { RenderBrief, Word, AuthoredScene, SceneSpec } from "../types.js";
import { planScenes } from "./scenes.js";
import { authorScene } from "./author.js";
import { qaScene } from "./qa.js";
import { composeScenes } from "./compose.js";
import { renderComposition, hyperframesAvailable } from "./hyperframes.js";
import { validateComposition } from "./sanitize.js";
import { assetsNamedInIntent, missingAssets } from "./assets-gate.js";
import { createSemaphore } from "../semaphore.js";
import sharp from "sharp";
import { fetchAssetBytes } from "./asset-source.js";

export { hyperframesAvailable };

// Guard against a malformed env value: Number("abc") is NaN, and `iter <= NaN`
// is always false, so produceScene's loop would never run and could return a
// scene as "success" with no rendered mov. Fall back to the default of 2.
// (e2e 2026-07-15: 1 retry -> 1/4 scenes pass, 2 retries -> 2/4; the 2nd retry
// recovers real scenes off the QA feedback, so a QUALITY tier keeps 2.)
const MAX_QA_ITERS_RAW = Number(process.env.PREMIUM_MAX_QA_ITERS);
const MAX_QA_ITERS =
  Number.isFinite(MAX_QA_ITERS_RAW) && MAX_QA_ITERS_RAW > 0 ? MAX_QA_ITERS_RAW : 2;

// Parallel scene production. Each scene is a HyperFrames Chromium render + ffmpeg composite, as heavy
// as a full render, so keep this low: 2 is the proven-safe ceiling on the live box (see semaphore.ts /
// DECISIONS.md 2026-07-10; 3 concurrent heavy renders OOM). Tunable via PREMIUM_CONCURRENCY, clamped 1..4.
const PREMIUM_CONCURRENCY_RAW = Number(process.env.PREMIUM_CONCURRENCY);
const PREMIUM_CONCURRENCY = Number.isFinite(PREMIUM_CONCURRENCY_RAW)
  ? Math.min(4, Math.max(1, Math.floor(PREMIUM_CONCURRENCY_RAW)))
  : 2;

// Escape hatch: skip the vision-QA gate so every rendered scene ships (useful for
// eyeballing raw premium output while QA is being tuned). SECURITY validation
// (validateComposition) still runs — we only bypass the aesthetic/accuracy check.
const SKIP_QA = /^(1|true|on|yes)$/i.test(process.env.PREMIUM_SKIP_QA ?? "");

// GSAP is served LOCALLY into each scene dir (no CDN) so a compliant scene needs zero network.
const require = createRequire(import.meta.url);
function gsapMinPath(): string {
  return join(dirname(require.resolve("gsap/package.json")), "dist", "gsap.min.js");
}

/** Injectable per-scene steps so produceScene is unit-testable without OpenAI/HyperFrames. */
export interface SceneDeps {
  author: typeof authorScene;
  render: typeof renderComposition;
  qa: typeof qaScene;
}
const DEFAULT_DEPS: SceneDeps = { author: authorScene, render: renderComposition, qa: qaScene };

function safeAssetName(src: string, i: number): string {
  const raw = basename(src.split("?")[0]) || `asset-${i}`;
  const clean = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(clean) ? clean : `${clean}.png`;
}

/**
 * Rasterize an SVG to a crisp PNG. The author embeds PNG screenshots far more reliably than SVG
 * logos (e2e 2026-07-15: SVG logos were the #1 skipped-scene cause — the model substitutes generic
 * icons). High density so small brand marks stay sharp when scaled up in a scene.
 */
async function rasterizeSvg(svgPath: string, pngPath: string): Promise<void> {
  await sharp(svgPath, { density: 384 }).resize(512, 512, { fit: "inside" }).png().toFile(pngPath);
}

/**
 * Fetch one asset into the workdir.
 *
 * Asset URLs are user-controlled, so this is an SSRF / local-file-read boundary: it is
 * https-only, allowlisted-host-only, DNS-checked against private ranges, redirect-free,
 * image-only and size-bounded (see asset-source.ts). Bare filesystem paths are rejected
 * outright — previously any non-http string was copied straight in, which would have let a
 * caller pull `/app/.env` into a scene and composite the service's API keys into the output.
 */
async function fetchAsset(src: string, destPath: string): Promise<void> {
  await writeFile(destPath, await fetchAssetBytes(src));
}

/**
 * Produce one scene: author -> validate -> render -> vision-QA, re-authoring against feedback
 * up to MAX_QA_ITERS times.
 *
 * Returns the scene WITH a movPath only when it is approved. If it can't be made safe/valid or
 * QA keeps rejecting it through the final retry, it returns WITHOUT a movPath so composeScenes
 * skips that beat (the base shows through) — a premium job never ships a QA-rejected or
 * unsanitized scene as if it succeeded. Throws only on hard author/render errors, which the
 * caller treats as a skipped beat too.
 */
export async function produceScene(
  args: {
    spec: SceneSpec;
    brief: RenderBrief;
    assetHints: string[];
    assetsDir: string;
    premiumDir: string;
    basePath: string;
    fps: number;
    log: (m: string) => void;
    /** Override the PREMIUM_SKIP_QA env default (mainly for deterministic tests). */
    skipQa?: boolean;
  },
  deps: SceneDeps = DEFAULT_DEPS,
): Promise<AuthoredScene> {
  const { spec, brief, assetHints, assetsDir, premiumDir, basePath, fps, log } = args;
  const skipQa = args.skipQa ?? SKIP_QA;

  // Each scene renders from its own dir; assets + local GSAP are copied in so `./assets/<name>`
  // and `./gsap.min.js` resolve with no network.
  const sceneDir = join(premiumDir, spec.id);
  const sceneAssets = join(sceneDir, "assets");
  await mkdir(sceneAssets, { recursive: true });
  await copyFile(gsapMinPath(), join(sceneDir, "gsap.min.js")).catch((e) =>
    log(`  ${spec.id}: could not stage local gsap (${(e as Error).message})`),
  );
  for (const name of assetHints) {
    await copyFile(join(assetsDir, name), join(sceneAssets, name)).catch(() => {});
  }

  const movPath = join(premiumDir, `${spec.id}.mov`);
  let issues: string[] | undefined;
  for (let iter = 0; iter <= MAX_QA_ITERS; iter++) {
    const last = iter === MAX_QA_ITERS;
    const html = await deps.author({ spec, brief, assetHints, priorIssues: issues });

    // Trust boundary: never render model HTML that references the network or eval's.
    const violations = validateComposition(html, assetHints);
    if (violations.length) {
      if (last) {
        log(`  ${spec.id}: rejected (unsafe/invalid HTML) — skipping: ${violations.slice(0, 2).join("; ")}`);
        return { spec, html };
      }
      issues = violations.map((v) => `MUST FIX (contract/security): ${v}`);
      log(`  ${spec.id}: re-author ${iter + 1} — ${violations.slice(0, 2).join("; ")}`);
      continue;
    }

    // Asset-inclusion gate: if the intent names specific assets, the HTML must embed them. Catches
    // the "described the logo but drew a generic icon" failure BEFORE a wasted render + vision call.
    const missing = missingAssets(html, assetsNamedInIntent(spec.intent, assetHints));
    if (missing.length && !last) {
      issues = [
        `MUST FIX: the intent requires featuring ${missing.join(", ")}, but your HTML never references ` +
          `${missing.length > 1 ? "them" : "it"}. Embed each with <img src="./assets/<file>" style="..."> ` +
          `as a real, visible element — not a generic icon, emoji, or CSS placeholder.`,
      ];
      log(`  ${spec.id}: re-author ${iter + 1} — missing required asset(s): ${missing.join(", ")}`);
      continue;
    }

    await deps.render({ html, sceneDir, outMovPath: movPath, fps });
    const qa = skipQa
      ? { ok: true as const, issues: [] as string[] }
      : await deps.qa({ spec, movPath, basePath, workDir: premiumDir });
    if (qa.ok) {
      const how = skipQa
        ? " (QA skipped)"
        : iter
          ? ` after ${iter} retr${iter === 1 ? "y" : "ies"}`
          : "";
      log(`  ${spec.id}: approved${how}`);
      return { spec, html, movPath };
    }
    if (last) {
      log(`  ${spec.id}: QA-rejected after ${iter} retr${iter === 1 ? "y" : "ies"} — skipping: ${qa.issues.slice(0, 2).join("; ")}`);
      return { spec, html };
    }
    issues = qa.issues;
    log(`  ${spec.id}: retry ${iter + 1} — ${qa.issues.slice(0, 2).join("; ")}`);
  }
  return { spec, html: "" };
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

  // 1. Fetch the assets folder; hints are the filenames the author may reference. SVG logos are
  //    rasterized to PNG (the author embeds PNGs far more reliably), and any ".svg" reference in the
  //    scene intents is rewritten to ".png" so the intent, the assetHints, and the gate all agree.
  const assetHints: string[] = [];
  const svgToPng = new Map<string, string>();
  for (const [i, src] of (brief.assets?.images ?? []).entries()) {
    try {
      const name = safeAssetName(src, i);
      await fetchAsset(src, join(assetsDir, name));
      if (/\.svg$/i.test(name)) {
        const png = name.replace(/\.svg$/i, ".png");
        try {
          await rasterizeSvg(join(assetsDir, name), join(assetsDir, png));
          svgToPng.set(name, png);
          assetHints.push(png);
        } catch (e) {
          log(`premium: svg rasterize failed (${name}), keeping svg: ${(e as Error).message}`);
          assetHints.push(name);
        }
      } else {
        assetHints.push(name);
      }
    } catch (e) {
      log(`premium: asset fetch failed (${src}): ${(e as Error).message}`);
    }
  }

  // 2. Storyboard, then repoint any ".svg" the intents named at the rasterized ".png".
  const specs = await planScenes({ brief, words, durationMs, assetHints });
  if (specs.length === 0) throw new Error("planScenes produced no scenes");
  for (const spec of specs) {
    for (const [svg, png] of svgToPng) spec.intent = spec.intent.split(svg).join(png);
  }
  log(`premium: ${specs.length} scenes planned, ${assetHints.length} assets`);

  // 3. Author -> render -> QA each scene, up to PREMIUM_CONCURRENCY at a time (order preserved).
  const sem = createSemaphore(PREMIUM_CONCURRENCY);
  const authored: AuthoredScene[] = await Promise.all(
    specs.map((spec) =>
      sem.run(async () => {
        try {
          return await produceScene({ spec, brief, assetHints, assetsDir, premiumDir, basePath, fps, log });
        } catch (e) {
          log(`premium: scene ${spec.id} failed, skipping — ${(e as Error).message}`);
          return { spec, html: "" } as AuthoredScene; // no movPath -> skipped in compose
        }
      }),
    ),
  );

  const rendered = authored.filter((s) => s.movPath).length;
  if (rendered === 0) throw new Error("premium: no scenes rendered");
  log(`premium: ${rendered}/${specs.length} scenes rendered`);

  // 4. Composite bespoke scenes over the captioned base.
  const sceneCount = await composeScenes(basePath, authored, outPath);
  return { outPath, sceneCount };
}
