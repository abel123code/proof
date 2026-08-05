/**
 * The render worker fetches whatever URLs this API forwards, following redirects and
 * buffering the whole body. So the only safe input is a URL we issued ourselves. This
 * is an allowlist against our own Supabase storage origin, not a denylist of bad hosts,
 * because a denylist loses to DNS rebinding and to every address literal nobody thought of.
 */
export const MAX_CLIPS = 12;

// If the `footage` bucket ever becomes private, clip URLs move to
// `/storage/v1/object/sign/footage/...` (signed URLs), and this prefix has to accept
// that shape in the same change, or every legitimate render gets rejected here.
const BUCKET_PREFIX = "/storage/v1/object/public/footage/";

export type UrlCheck = { ok: true; urls: string[] } | { ok: false; error: string };

export function validateVideoUrls(value: unknown, supabaseUrl: string | undefined): UrlCheck {
  if (!supabaseUrl) return { ok: false, error: "Storage is not configured." };
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "videoUrls (non-empty) is required" };
  }
  if (value.length > MAX_CLIPS) {
    return { ok: false, error: `A render can use at most ${MAX_CLIPS} clips.` };
  }

  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(supabaseUrl).origin;
  } catch {
    return { ok: false, error: "Storage is not configured." };
  }

  const urls: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string" || !raw) {
      return { ok: false, error: "Every clip must be a URL string." };
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, error: "That clip is not a valid URL." };
    }
    // Compare full origin, so a lookalike host like ours.supabase.co.evil.com fails.
    if (parsed.origin !== allowedOrigin) {
      return { ok: false, error: "Clips must be footage uploaded to Proof." };
    }
    // new URL() normalises ".." during parsing, so a path that tries to walk out of
    // the bucket no longer starts with the prefix by the time we check it.
    if (!parsed.pathname.startsWith(BUCKET_PREFIX)) {
      return { ok: false, error: "Clips must be footage uploaded to Proof." };
    }
    urls.push(parsed.toString());
  }
  return { ok: true, urls };
}
