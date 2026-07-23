import { spawn } from "node:child_process";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const COMPOSITION_HEIGHT = 1920;

/**
 * Single source of truth for the caption keep-out line. Derived from render/remotion/tokens.ts:
 * the caption pill sits `bottom: SUBTITLE.bottomOffset` (260px) from the frame bottom, so its
 * bottom edge is at y=1660; a 2-line pill (fontSize 44, padV 12) tops near y=1520. 1450 sits a
 * conservative ~70px above that AND matches the legacy speaker-mask value. Captions are capped at
 * ≤5 words / ≤30 chars (CAPTION.maxWords/maxChars), so they never wrap past two lines. If the
 * caption tokens change materially, update this constant and caption-guard.test.ts together.
 */
export const CAPTION_ZONE_TOP_Y = 1450;

// Peak alpha (0..255) above which a caption-band pixel counts as "meaningfully present". ~10%
// catches semi-transparent panels while ignoring sub-pixel anti-alias fringe.
const ALPHA_INTRUSION_THRESHOLD = 26;

/** The concrete edit handed to the author when a scene reaches into the caption band. */
export function captionIntrusionIssue(): string {
  return (
    `MUST FIX: part of the graphic reaches into the bottom caption band (below y=${CAPTION_ZONE_TOP_Y}) ` +
    `and would cover the burned-in captions. Move that element UP so nothing renders below ` +
    `y=${CAPTION_ZONE_TOP_Y}; keep the caption band fully clear.`
  );
}

/**
 * Deterministic caption check (NOT an erase): crop the overlay to the caption band and, across
 * EVERY frame, measure the peak alpha. If any frame has a meaningfully-opaque (incl. semi-
 * transparent) pixel there, the graphic intrudes and the scene is sent back to move up. Read-only:
 * it never mutates the MOV — it only probes it.
 */
export function overlayIntrudesCaptionBand(movPath: string): Promise<boolean> {
  const bandHeight = COMPOSITION_HEIGHT - CAPTION_ZONE_TOP_Y;
  return new Promise((resolve, reject) => {
    // Crop to the caption band, normalise to 8-bit rgba (the overlay MOVs are prores 4444 / yuva444p12le,
    // whose alpha reads on a bit-depth-dependent scale — format=rgba maps transparent→0, opaque→255),
    // extract its alpha as luma, print per-frame peak (YMAX). No -frames limit: the whole clip is
    // scanned so a graphic that only dips into the band mid-animation is still caught.
    const args = [
      "-i", movPath,
      "-vf", `crop=1080:${bandHeight}:0:${CAPTION_ZONE_TOP_Y},format=rgba,alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMAX`,
      "-an", "-f", "null", "-",
    ];
    const p = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`caption probe exited ${code}:\n${stderr.slice(-800)}`));
      const peaks = [...stderr.matchAll(/YMAX=(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
      resolve(peaks.some((v) => v > ALPHA_INTRUSION_THRESHOLD));
    });
  });
}
