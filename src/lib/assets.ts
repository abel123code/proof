import type { RenderAssets } from "@/lib/types";

/** Max brand images kept on a brief — enough for a few screenshots + logos, bounded so a client
 * can't bloat the row. */
export const MAX_ASSET_IMAGES = 12;

/**
 * Validate + clamp a client-supplied assets object before it's persisted onto a brief. Keeps only
 * http(s) image URLs (capped), trims text fields, and drops everything blank. Note: the render
 * service independently SSRF-guards which asset hosts it will actually fetch (see the premium
 * asset-source allowlist), so this is app-side hygiene, not the security boundary.
 */
export function sanitizeAssets(raw: Record<string, unknown>): RenderAssets {
  const images = Array.isArray(raw.images)
    ? raw.images
        .filter((u): u is string => typeof u === "string")
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u))
        .slice(0, MAX_ASSET_IMAGES)
    : [];

  const str = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

  const out: RenderAssets = {};
  if (images.length) out.images = images;
  const brandColor = str(raw.brandColor, 32);
  const brandVoice = str(raw.brandVoice, 500);
  const motif = str(raw.motif, 300);
  if (brandColor) out.brandColor = brandColor;
  if (brandVoice) out.brandVoice = brandVoice;
  if (motif) out.motif = motif;
  return out;
}
