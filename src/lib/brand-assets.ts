/**
 * The render worker fetches whatever URLs a brief carries, following redirects and
 * buffering the whole body. So the only safe input is a URL we issued ourselves. This
 * is an allowlist against our own Supabase storage origin, not a denylist of bad hosts,
 * because a denylist loses to DNS rebinding and to every address literal nobody thought of.
 */
// Briefs target 4-7 scenes; 8 covers roughly one image per scene plus a logo.
export const MAX_ASSETS = 8;

// If the `brand-assets` bucket ever becomes private, asset URLs move to
// `/storage/v1/object/sign/brand-assets/...` (signed URLs), and this prefix has to accept
// that shape in the same change, or every render loses its images.
const BUCKET_PREFIX = "/storage/v1/object/public/brand-assets/";

export type AssetCheck = { ok: true; urls: string[] } | { ok: false; error: string };

export function validateAssetUrls(value: unknown, supabaseUrl: string | undefined): AssetCheck {
  if (!supabaseUrl) return { ok: false, error: "Storage is not configured." };
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "assetUrls (non-empty) is required" };
  }

  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(supabaseUrl).origin;
  } catch {
    return { ok: false, error: "Storage is not configured." };
  }

  // Dedupe before capping, so a user who accidentally double-adds the same file
  // isn't told they hit the limit.
  const deduped = Array.from(new Set(value));
  if (deduped.length > MAX_ASSETS) {
    return { ok: false, error: `A brief can use at most ${MAX_ASSETS} images.` };
  }

  const urls: string[] = [];
  for (const raw of deduped) {
    if (typeof raw !== "string" || !raw) {
      return { ok: false, error: "Images must be uploaded to Proof." };
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, error: "Images must be uploaded to Proof." };
    }
    // Compare full origin, so a lookalike host like ours.supabase.co.evil.com fails.
    if (parsed.origin !== allowedOrigin) {
      return { ok: false, error: "Images must be uploaded to Proof." };
    }
    // new URL() normalises ".." during parsing, so a path that tries to walk out of
    // the bucket no longer starts with the prefix by the time we check it.
    if (!parsed.pathname.startsWith(BUCKET_PREFIX)) {
      return { ok: false, error: "Images must be uploaded to Proof." };
    }
    urls.push(parsed.toString());
  }
  return { ok: true, urls };
}
