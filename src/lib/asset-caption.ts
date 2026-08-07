/**
 * One-line descriptions of the images a brief carries, so the render planner knows what it has.
 *
 * The planner is handed asset filenames, which are UUIDs. It has a rule that real assets should be
 * used only when they materially prove a claim, but with opaque names it cannot apply that rule. On
 * a brief whose script mentioned a Telegram chat with no Telegram screenshot uploaded, it requested
 * one anyway, the author substituted the nearest screenshot, and the finished video showed the
 * product while the voiceover said Telegram. Descriptions let the planner tell "I have no image of
 * that" from "I have one".
 *
 * Captioned once at upload and stored on the brief. The vision call is a rounding error next to a
 * render, which analyses ~90 frames.
 */

/** Keyed by the filename the render worker stages the image under: the URL's basename. */
export type AssetDescriptions = Record<string, string>;

export interface CaptionDeps {
  /** Describe one image by URL. Injected so the failure paths are testable without a network. */
  describe: (url: string) => Promise<string>;
}

/**
 * The worker derives a staged filename from the URL basename, so descriptions must be keyed the
 * same way or every lookup silently misses. An SVG is rasterised to .png before staging, so its
 * description has to be filed under the .png name it will end up with.
 */
export function stagedFileName(url: string): string {
  const base = (url.split("?")[0].split("/").pop() ?? "asset").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base.replace(/\.svg$/i, ".png");
}

export const MAX_DESCRIPTION_CHARS = 200;

/** Trim to one tidy line: the planner reads these inline, and a paragraph would drown its prompt. */
export function normalizeDescription(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DESCRIPTION_CHARS
    ? `${oneLine.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`
    : oneLine;
}

/**
 * Describe every image, skipping any already described.
 *
 * A caption failure must never block an upload: the asset is still usable, the planner just treats
 * it as unknown, which is exactly the conservative behaviour we want. So failures are dropped
 * rather than thrown.
 */
export async function describeAssets(
  urls: string[],
  deps: CaptionDeps,
  existing: AssetDescriptions = {},
): Promise<AssetDescriptions> {
  const out: AssetDescriptions = { ...existing };

  // Only the ones we do not already know, deduped: a brief can list the same image twice, and
  // describing it twice would pay for the same answer.
  const pending = [...new Set(urls.map(stagedFileName).filter((key) => !out[key]))];
  const byKey = new Map(urls.map((url) => [stagedFileName(url), url]));

  // Concurrently, because this runs inside the upload request. Sequentially it was 26 seconds for
  // five images, which is a visible hang on a button press.
  const settled = await Promise.allSettled(
    pending.map(async (key) => ({
      key,
      text: normalizeDescription(await deps.describe(byKey.get(key) as string)),
    })),
  );

  for (const result of settled) {
    // A rejection is dropped, not thrown: the asset is still usable and the planner reads a
    // missing entry as "unknown", which keeps it from treating the image as proof of a claim.
    if (result.status === "fulfilled" && result.value.text) {
      out[result.value.key] = result.value.text;
    }
  }
  return out;
}
