/**
 * Client helper for uploading brand-asset images (screenshots / a logo) straight to
 * Supabase Storage via a signed ticket. This is the sibling of uploadSceneFootageDirect
 * in upload.ts and follows the same shape: pre-flight check, mint a ticket, PUT with
 * progress. Unlike scene footage there is no per-file "confirm" endpoint - assets are
 * captioned and persisted as a batch by POST /api/assets, so this helper only has to
 * get the bytes into Storage and hand back the public URL the caller will collect into
 * that batch.
 */

/**
 * Hard ceiling on a single brand asset, in bytes - the `brand-assets` bucket's own
 * limit (see createAssetUploadTicket in db.ts / /api/assets/sign). Checked here too so
 * the user hears about it before spending an upload's worth of time on a file the
 * server would reject anyway.
 */
export const MAX_ASSET_BYTES = 15 * 1024 * 1024;
const MAX_ASSET_MB = Math.round(MAX_ASSET_BYTES / (1024 * 1024));

/**
 * Raster formats only. SVG is deliberately excluded even though the `brand-assets`
 * bucket itself would store it: an SVG is a script-bearing XML document, not just
 * pixels, and these files are later fetched and composited directly by the render
 * worker (see the allowlist in /api/assets/sign and validateAssetUrls in
 * brand-assets.ts). Accepting SVG here would hand that fetch-and-composite path a
 * document type it has no business parsing.
 */
export const ACCEPTED_ASSET_TYPES = ["image/png", "image/jpeg", "image/webp"];
const ACCEPTED_FORMATS_LABEL = "PNG, JPEG, or WebP";

/** One message for the pre-flight size check, naming the limit and what to do about it. */
export function assetTooLargeMessage(): string {
  return `That image is over the ${MAX_ASSET_MB}MB upload limit. Resize or compress it and try again.`;
}

/** One message for the pre-flight type check, naming the accepted formats and what to do. */
export function assetTypeMessage(): string {
  return `Only ${ACCEPTED_FORMATS_LABEL} images are accepted here. Convert the file and try again.`;
}

/**
 * The public URL Supabase serves a stored object at, composed locally so a per-file
 * upload doesn't need a server round trip just to learn its own URL. Mirrors
 * BUCKET_PREFIX in brand-assets.ts - move both together if the bucket ever goes private
 * (public URLs would become `/storage/v1/object/sign/brand-assets/...` instead).
 */
function publicAssetUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("Storage is not configured.");
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/brand-assets/${path}`;
}

/**
 * Upload one brand-asset image straight to Supabase Storage via a signed ticket, so
 * the bytes never transit the Vercel function. Three steps: pre-flight -> mint ticket
 * -> PUT direct to Supabase (with progress). `onProgress` reports 0..1. Returns the
 * asset's public URL.
 */
export async function uploadBrandAsset(input: {
  briefId: string;
  file: File;
  onProgress?: (fraction: number) => void;
}): Promise<string> {
  // Checked before a ticket is minted, same reasoning as uploadSceneFootageDirect: the
  // browser already knows the size and type, so failing here is instant instead of a
  // slow upload that the server was always going to reject.
  if (input.file.size > MAX_ASSET_BYTES) throw new Error(assetTooLargeMessage());
  if (!ACCEPTED_ASSET_TYPES.includes(input.file.type)) throw new Error(assetTypeMessage());

  // 1. Mint a signed upload ticket (tiny JSON, immune to the body limit).
  const signRes = await fetch("/api/assets/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ briefId: input.briefId, contentType: input.file.type }),
  });
  const ticket = await signRes.json().catch(() => ({}));
  if (!signRes.ok) throw new Error(ticket.error ?? "Could not start upload");
  const { path, signedUrl } = ticket as { path: string; token: string; signedUrl: string };

  // 2. PUT the file straight to Supabase, tracking progress. Mirrors supabase-js's
  //    uploadToSignedUrl wire format: PUT, multipart body { cacheControl, "": file }, x-upsert.
  await new Promise<void>((resolve, reject) => {
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", input.file);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    // A single image is small; five minutes is generous even on a slow connection and
    // still stops a stalled request (no data, no error) from hanging the UI forever.
    xhr.timeout = 5 * 60 * 1000;
    xhr.setRequestHeader("x-upsert", "true"); // do NOT set content-type, the browser sets the multipart boundary
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) input.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // Backstop for anything the pre-flight check missed, e.g. a stale tab running
      // older JS after the limit changed. A bare "Upload failed (413)" tells the user nothing.
      if (xhr.status === 413) return reject(new Error(assetTooLargeMessage()));
      reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed, network error"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.send(form);
  });
  input.onProgress?.(1);

  return publicAssetUrl(path);
}
