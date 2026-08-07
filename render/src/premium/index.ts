import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";
import type {
  RenderBrief,
  Word,
  AuthoredScene,
  SceneSpec,
  SceneQAOutcome,
  SceneIssue,
  SceneReport,
  CreativeDirection,
} from "../types.js";
import { planEdit } from "./scenes.js";
import { authorScene } from "./author.js";
import { qaScene } from "./qa.js";
import { composeCreatorNativeVideo } from "./compose.js";
import { renderComposition, hyperframesAvailable } from "./hyperframes.js";
import { validateComposition } from "./sanitize.js";
import { fetchAssetBytes } from "./asset-source.js";
import { assetsNamedInIntent, missingAssets } from "./assets-gate.js";
import { DEFAULT_ACCENT } from "./accent.js";
import { checkSceneMotion } from "./motion-gate.js";
import { checkImageFraming } from "./framing-gate.js";
import { createSemaphore } from "../semaphore.js";
import { captionIntrusionIssue, overlayIntrudesCaptionBand } from "./caption-guard.js";
import { maskOverlaySafeZones } from "../ffmpeg.js";
import sharp from "sharp";

export { hyperframesAvailable };

// Guard against a malformed env value: Number("abc") is NaN, and `iter <= NaN`
// is always false, so produceScene's loop would never run. A NEGATIVE or non-finite
// value falls back to the default of 2. ZERO is a VALID, deliberate setting: "author
// once, let QA flag it, ship it flagged — no retries, no relocation" — the advisory-only
// mode used to A/B whether the vision QA earns its latency (does the raw author produce
// good scenes on its own?). See the QA-value experiment in DECISIONS.md.
// (e2e 2026-07-15: 1 retry -> 1/4 scenes pass, 2 retries -> 2/4.)
const MAX_QA_ITERS_RAW = Number(process.env.PREMIUM_MAX_QA_ITERS);
const MAX_QA_ITERS =
  Number.isFinite(MAX_QA_ITERS_RAW) && MAX_QA_ITERS_RAW >= 0 ? MAX_QA_ITERS_RAW : 2;

// Parallel scene production. Each scene is a HyperFrames Chromium render + ffmpeg composite, as heavy
// as a full render, so keep this low: 2 is the proven-safe ceiling on the live box (see semaphore.ts /
// DECISIONS.md 2026-07-10; 3 concurrent heavy renders OOM). Tunable via PREMIUM_CONCURRENCY, clamped 1..4.
const PREMIUM_CONCURRENCY_RAW = Number(process.env.PREMIUM_CONCURRENCY);
const PREMIUM_CONCURRENCY = Number.isFinite(PREMIUM_CONCURRENCY_RAW)
  ? Math.min(4, Math.max(1, Math.floor(PREMIUM_CONCURRENCY_RAW)))
  : 2;

// Vision QA is mandatory for every scene that reaches the premium composite.

// GSAP is served LOCALLY into each scene dir (no CDN) so a compliant scene needs zero network.
const require = createRequire(import.meta.url);
function gsapMinPath(): string {
  return join(dirname(require.resolve("gsap/package.json")), "dist", "gsap.min.js");
}

/** Injectable per-scene steps so produceScene is unit-testable without OpenAI/HyperFrames/ffmpeg. */
export interface SceneDeps {
  author: typeof authorScene;
  render: typeof renderComposition;
  qa: typeof qaScene;
  mask?: typeof maskOverlaySafeZones;
  /** Deterministic caption-band intrusion check (not an erase). Stubbed to a constant in unit tests. */
  captionCheck?: typeof overlayIntrudesCaptionBand;
}
const DEFAULT_DEPS: SceneDeps = {
  author: authorScene,
  render: renderComposition,
  qa: qaScene,
  mask: maskOverlaySafeZones,
  captionCheck: overlayIntrudesCaptionBand,
};

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
 * outright because local files can contain service credentials.
 */
async function fetchAsset(src: string, destPath: string): Promise<void> {
  await writeFile(destPath, await fetchAssetBytes(src));
}

/**
 * Produce one scene: author -> validate -> render -> vision-QA, patching against feedback up to
 * MAX_QA_ITERS times. This is an AUDITABLE ADVISOR, not a gatekeeper.
 *
 * The scene ALWAYS ships (returns a movPath) carrying a {@link SceneReport} — the verdict plus the
 * exact reasoning — so the app can show the user why and ask whether to re-render. Behaviour:
 * - OBJECTIVE (safety) faults — a graphic on a face feature, a caption-band intrusion, garbled/clipped
 *   text, a missing required asset — drive an auto-patch each round; if still unresolved at the last
 *   attempt the scene SHIPS FLAGGED (never omitted).
 * - SUBJECTIVE notes (creative/copy/polish) NEVER block and NEVER drive a re-author; they ride along
 *   as flags for the human.
 * The ONE non-ship case is `base_fallback`: the HTML never cleared the security validator, so it
 * cannot be rendered at all and that beat shows the captioned base (reported, not silently dropped).
 * Throws only on a hard author/render crash, which the caller records as a base_fallback beat.
 */
/** One rendered attempt, for observability/measurement (e.g. the probe's per-attempt artifacts). */
export interface SceneAttemptRecord {
  attempt: number;
  outcome: SceneQAOutcome | "caption_reject";
  issues: SceneIssue[];
  html: string;
  /** The overlay MOV as it stood for this attempt (overwritten by the next attempt). */
  movPath: string;
}

export async function produceScene(
  args: {
    spec: SceneSpec;
    brief: RenderBrief;
    creativeDirection?: CreativeDirection;
    assetHints: string[];
    /** What each asset depicts and where its important content sits, keyed by filename — forwarded
     *  to the author so it can crop to the named region instead of placing a wide capture whole. */
    assetDescriptions?: Record<string, string>;
    assetsDir: string;
    premiumDir: string;
    basePath: string;
    captionOverlayPath?: string;
    fps: number;
    log: (m: string) => void;
    /** Called after each RENDERED attempt (awaited) so a caller can snapshot artifacts before the
     *  next attempt overwrites the MOV/frames. */
    onAttempt?: (rec: SceneAttemptRecord) => Promise<void> | void;
  },
  deps: SceneDeps = DEFAULT_DEPS,
): Promise<AuthoredScene> {
  const { spec, brief, assetHints, assetDescriptions, assetsDir, premiumDir, basePath, captionOverlayPath, fps, log } = args;
  const creativeDirection = args.creativeDirection ?? {
    backgroundColor: "#101114",
    textColor: "#ffffff",
    emphasisColor: brief.assets?.brandColor || brief.accentColor || DEFAULT_ACCENT,
    successColor: "#79f28b",
    failureColor: "#ff4f9a",
    displayStyle: "bold geometric sans serif",
    technicalStyle: "clean monospace",
    transitionStyle: "hard cuts and direct state replacement",
    motif: spec.motif,
  };

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
  const captionCheck = deps.captionCheck ?? overlayIntrudesCaptionBand;

  // --- audit-report builders: a scene ALWAYS returns a report ---
  const report = (over: Partial<SceneReport>): SceneReport => ({
    sceneId: spec.id,
    anchorMs: spec.anchorMs,
    durMs: spec.durMs,
    mode: spec.mode,
    backgroundTreatment: spec.backgroundTreatment ?? "footage",
    rationale: spec.rationale,
    intent: spec.intent,
    verdict: "clean",
    shipped: true,
    issues: [],
    attempts: 0,
    ...over,
  });
  /** Ship the current render, carrying any unresolved issues as flags (clean when none). */
  const ship = (issues: SceneIssue[], attempts: number): AuthoredScene => ({
    spec,
    html,
    movPath,
    report: report({ verdict: issues.length ? "flagged" : "clean", shipped: true, issues, attempts }),
  });
  /** The ONLY non-ship path: no safe render exists, so this beat shows the base. */
  const baseFallback = (issues: SceneIssue[], attempts: number): AuthoredScene => ({
    spec,
    html,
    report: report({ verdict: "base_fallback", shipped: false, issues, attempts }),
  });
  const texts = (issues: SceneIssue[]) => issues.map((i) => i.text);

  let safetyIssues: SceneIssue[] = []; // the safety faults the next patch must fix (subjective never patches)
  let priorHtml: string | undefined; // the last rendered draft — fed back so an edit patches, not rerolls
  let html = "";
  let hasRender = false; // a validated render exists at movPath (used if the final HTML turns unsafe)
  let retryQaOnly = false; // set after an operational QA error: re-judge the SAME render, don't re-author

  for (let iter = 0; iter <= MAX_QA_ITERS; iter++) {
    const last = iter === MAX_QA_ITERS;
    const attempts = iter + 1;
    // Deterministic safety flags we're SHIPPING WITH this round (only ever populated on `last`,
    // since earlier attempts patch-and-continue instead).
    let deterministicFlags: SceneIssue[] = [];

    if (!retryQaOnly) {
      html = await deps.author({
        spec,
        brief,
        creativeDirection,
        assetHints,
        assetDescriptions,
        priorIssues: safetyIssues.length ? texts(safetyIssues) : undefined,
        priorHtml,
      });

      // Trust boundary: never render model HTML that references the network or eval's. This is the
      // one fault we can't ship around — unrenderable HTML means the beat shows the base.
      const violations = validateComposition(html, assetHints);
      if (violations.length) {
        const vIssues: SceneIssue[] = violations.map((v) => ({ kind: "safety", text: `MUST FIX (security): ${v}` }));
        if (last) {
          if (hasRender) {
            log(`  ${spec.id}: final HTML unsafe — shipping the last safe render, flagged`);
            return ship(vIssues, attempts);
          }
          log(`  ${spec.id}: no safe render — base shows for this beat: ${violations.slice(0, 2).join("; ")}`);
          return baseFallback(vIssues, attempts);
        }
        safetyIssues = vIssues;
        priorHtml = html;
        log(`  ${spec.id}: re-author ${attempts} — unsafe HTML: ${violations.slice(0, 2).join("; ")}`);
        continue;
      }

      // Asset-inclusion (objective): if the intent names assets, the HTML must embed them. Drives a
      // patch; on the final attempt the scene still RENDERS and SHIPS FLAGGED (never omitted).
      const missing = missingAssets(html, assetsNamedInIntent(spec.intent, assetHints));
      if (missing.length) {
        const mIssue: SceneIssue = {
          kind: "safety",
          text:
            `MUST FIX: the intent requires featuring ${missing.join(", ")}, but the HTML never references ` +
            `${missing.length > 1 ? "them" : "it"}. Embed each with <img src="./assets/<file>" style="..."> ` +
            `as a real, visible element — not a generic icon, emoji, or CSS placeholder.`,
        };
        if (!last) {
          safetyIssues = [mIssue];
          priorHtml = html;
          log(`  ${spec.id}: re-author ${attempts} — missing required asset(s): ${missing.join(", ")}`);
          continue;
        }
        deterministicFlags.push(mIssue); // last attempt: render + ship flagged
      }

      // Framing (objective): a staged screenshot placed with no cropping/scaling intent is the
      // #1 production QA complaint — a wide desktop capture shrunk whole into a 1080x1920 frame
      // leaves interface text unreadable and clips labels at the edge. Drives a patch; on the final
      // attempt the scene still RENDERS and SHIPS FLAGGED (never omitted).
      const framing = checkImageFraming(html);
      if (!framing.ok) {
        const framingIssue: SceneIssue = { kind: "safety", text: framing.reason! };
        if (!last) {
          safetyIssues = [framingIssue];
          priorHtml = html;
          log(`  ${spec.id}: re-author ${attempts} — asset placed with no cropping/scaling intent`);
          continue;
        }
        deterministicFlags.push(framingIssue);
      }

      // Motion (objective): a timeline dominated by an empty padding tween, or with only one real
      // beat, is a frozen scene wearing an animation's clothes — the #1 measured pass-rate failure
      // (53s production render, mean pixel delta 0.0-1.9 between cuts for seconds at a time). Drives
      // a patch; on the final attempt the scene still RENDERS and SHIPS FLAGGED (never omitted).
      const motion = checkSceneMotion(html, spec.durMs / 1000);
      if (!motion.ok) {
        const motionIssue: SceneIssue = { kind: "safety", text: motion.reason! };
        if (!last) {
          safetyIssues = [motionIssue];
          priorHtml = html;
          log(`  ${spec.id}: re-author ${attempts} — frozen timeline (holdRatio ${motion.holdRatio.toFixed(2)})`);
          continue;
        }
        deterministicFlags.push(motionIssue);
      }

      await deps.render({ html, sceneDir, outMovPath: movPath, fps });
      if (spec.mode === "overlay" && deps.mask) await deps.mask(movPath);
      hasRender = true;

      // Deterministic caption protection (safety, NOT an erase): if the graphic reaches into the fixed
      // caption band, patch it up. On the last attempt, ship flagged (the human decides).
      if (await captionCheck(movPath)) {
        const capIssue = captionIntrusionIssue();
        await args.onAttempt?.({ attempt: iter, outcome: "caption_reject", issues: [capIssue], html, movPath });
        if (!last) {
          safetyIssues = [capIssue];
          priorHtml = html;
          log(`  ${spec.id}: re-edit ${attempts} — graphic intrudes the caption band`);
          continue;
        }
        deterministicFlags.push(capIssue);
      }
    }
    retryQaOnly = false;

    const qa = await deps.qa({ spec, movPath, basePath, captionOverlayPath, workDir: premiumDir, assetHints });
    await args.onAttempt?.({ attempt: iter, outcome: qa.outcome, issues: qa.issues, html, movPath });

    if (qa.outcome === "operational_error") {
      if (last) {
        // Rendered fine but no verdict — ship it, flag that QA couldn't review (subjective note).
        log(`  ${spec.id}: QA unavailable on the final attempt — shipping, flagged for review`);
        return ship(
          [...deterministicFlags, { kind: "subjective", text: "QA review was unavailable for this scene." }],
          attempts,
        );
      }
      log(`  ${spec.id}: QA operational error — retrying the review on the same render`);
      retryQaOnly = true;
      continue;
    }

    const safety = [...deterministicFlags, ...qa.issues.filter((i) => i.kind === "safety")];
    const subjective = qa.issues.filter((i) => i.kind === "subjective");

    if (safety.length === 0) {
      // No objective fault -> ship. Subjective notes ride along as flags; they never blocked.
      log(
        `  ${spec.id}: ${subjective.length ? `shipping with ${subjective.length} subjective note(s)` : "clean"}` +
          `${iter ? ` after ${iter} edit${iter === 1 ? "" : "s"}` : ""}`,
      );
      return ship(subjective, attempts);
    }

    if (last) {
      // Budget spent with unresolved safety faults -> SHIP FLAGGED (never omit; the human decides).
      log(
        `  ${spec.id}: shipping FLAGGED after ${iter} edit${iter === 1 ? "" : "s"} — unresolved: ` +
          `${texts(safety).slice(0, 2).join("; ")}`,
      );
      return ship([...safety, ...subjective], attempts);
    }

    // Patch against the safety faults only; subjective notes never drive a re-author.
    priorHtml = html;
    safetyIssues = safety;
    log(`  ${spec.id}: re-edit ${attempts} — ${texts(safety).slice(0, 2).join("; ")}`);
  }

  // Unreachable: the loop always returns. Ship whatever last rendered, unflagged, as a safe default.
  return ship([], MAX_QA_ITERS + 1);
}

/**
 * The premium render path: one global creator-native edit plan -> per-beat HyperFrames authoring ->
 * mode-aware vision QA -> visuals over clean footage -> captions last. Any hard failure throws so
 * job.ts can fall back to its already-rendered captioned base.
 */
export async function runPremium(args: {
  basePath: string; // clean cut footage; creator-native visuals composite here first
  captionOverlayPath: string; // Remotion alpha layer, burned after every premium visual
  outPath: string;
  brief: RenderBrief;
  words: Word[];
  durationMs: number;
  workDir: string;
  fps?: number;
  log?: (m: string) => void;
}): Promise<{ outPath: string; sceneCount: number; reports: SceneReport[] }> {
  const { basePath, captionOverlayPath, outPath, brief, words, durationMs, workDir } = args;
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

  // 2. Plan the whole edit before authoring individual scenes. TypeScript enforces the final
  //    coverage and recovery budgets; the model supplies semantic mode choices and shared direction.
  const editPlan = await planEdit({
    brief,
    words,
    durationMs,
    assetHints,
    assetDescriptions: brief.assets?.imageDescriptions,
  });
  const specs = editPlan.scenes;
  for (const spec of specs) {
    for (const [svg, png] of svgToPng) spec.intent = spec.intent.split(svg).join(png);
  }
  log(
    `premium: ${specs.length} creator-native scenes planned ` +
      `(${Math.round(editPlan.coverage.fullFrameRatio * 100)}% full-frame, ` +
      `${Math.round(editPlan.coverage.overlayRatio * 100)}% overlay, ` +
      `${Math.round(editPlan.coverage.cleanRatio * 100)}% clean), ${assetHints.length} assets`,
  );
  await writeFile(join(premiumDir, "edit-plan.json"), JSON.stringify(editPlan, null, 2)).catch(() => {});

  // 3. Author -> render -> QA each scene, up to PREMIUM_CONCURRENCY at a time (order preserved).
  //    Every scene returns an auditable report; a hard crash becomes a reported base_fallback, never
  //    a silent drop.
  const sem = createSemaphore(PREMIUM_CONCURRENCY);
  const authored: AuthoredScene[] = await Promise.all(
    specs.map((spec) =>
      sem.run(async () => {
        try {
          return await produceScene({
            spec,
            brief,
            creativeDirection: editPlan.creativeDirection,
            assetHints,
            assetDescriptions: brief.assets?.imageDescriptions,
            assetsDir,
            premiumDir,
            basePath,
            captionOverlayPath,
            fps,
            log,
          });
        } catch (e) {
          const msg = (e as Error).message;
          log(`premium: scene ${spec.id} crashed — base shows for this beat: ${msg}`);
          return {
            spec,
            html: "",
            report: {
              sceneId: spec.id,
              anchorMs: spec.anchorMs,
              durMs: spec.durMs,
              mode: spec.mode,
              backgroundTreatment: spec.backgroundTreatment ?? "footage",
              rationale: spec.rationale,
              intent: spec.intent,
              verdict: "base_fallback",
              shipped: false,
              issues: [{ kind: "safety", text: `Scene render crashed: ${msg}` }],
              attempts: 0,
            },
          } satisfies AuthoredScene;
        }
      }),
    ),
  );

  const reports = authored.map((s) => s.report);
  const shipped = authored.filter((s) => s.movPath).length;
  const flagged = reports.filter((r) => r.verdict === "flagged").length;
  log(
    `premium: ${shipped}/${specs.length} scenes shipped (${flagged} flagged), ` +
      `${specs.length - shipped} base-fallback`,
  );

  // Emit the auditable per-scene report next to the render so job.ts can persist it and the app can
  // show the user each scene's verdict + reasoning and ask whether to re-render.
  await writeFile(join(premiumDir, "scene-report.json"), JSON.stringify(reports, null, 2)).catch(() => {});

  // 4. Composite creator visuals onto clean footage, then burn captions last. Opaque full-frame
  //    explanations can own the image without hiding the accessibility layer.
  const sceneCount = await composeCreatorNativeVideo({
    basePath,
    scenes: authored,
    captionOverlayPath,
    visualPath: join(premiumDir, "visual.mp4"),
    outPath,
  });
  return { outPath, sceneCount, reports };
}
