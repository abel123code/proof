/**
 * Normalize a video mime to a browser-playable container label.
 *
 * Phones/screen-recorders report H.264 clips as `video/quicktime` (a .mov). Storing them raw
 * (as a `.webm` with a quicktime content-type, the old mapping) makes the in-app <video> preview
 * a black box even though the file is fine and renders fine. H.264 in a mov/mp4 (ISOBMFF)
 * container plays in-browser when it's labelled mp4, so map everything that isn't webm to mp4.
 * (The render service re-encodes anything genuinely odd anyway.)
 */
export function normalizeVideoType(raw: string | undefined): { contentType: string; ext: string } {
  const t = (raw || "").toLowerCase();
  if (t.includes("webm")) return { contentType: "video/webm", ext: "webm" };
  return { contentType: "video/mp4", ext: "mp4" };
}

/**
 * Hard ceiling on a single clip, in bytes.
 *
 * Not our choice. Supabase enforces a per-project ceiling and on the current plan it is
 * exactly 50MB: setting the footage bucket's file_size_limit to 51MB is rejected with a
 * 413, 50MB is accepted. Raising this means changing the Supabase plan, not editing this
 * constant, so move both together if that ever happens.
 */
export const MAX_CLIP_BYTES = 50 * 1024 * 1024;
const MAX_CLIP_MB = Math.round(MAX_CLIP_BYTES / (1024 * 1024));

/** One message for both the pre-flight check and the server's 413, so they cannot drift. */
export function tooLargeMessage(): string {
  return `That clip is over the ${MAX_CLIP_MB}MB upload limit. Record a shorter take or compress it.`;
}

/**
 * Upload a scene clip straight to Supabase Storage via a signed ticket, so the bytes never
 * transit the Vercel function (whose ~4.5MB request-body limit capped clips at ~30s).
 * Three steps: mint ticket -> PUT direct to Supabase (with progress) -> confirm the row.
 * `onProgress` reports 0..1 during the upload. Returns the persisted public URL.
 */
export async function uploadSceneFootageDirect(input: {
  briefId: string;
  sceneIndex: number;
  file: Blob;
  contentType?: string;
  onProgress?: (fraction: number) => void;
}): Promise<string> {
  // Checked before the ticket is minted, because the browser already knows the size and
  // Supabase would only reject it after the whole file went up. On a slow connection that
  // is minutes of progress bar ending in a failure the user could have been told about
  // instantly.
  if (input.file.size > MAX_CLIP_BYTES) throw new Error(tooLargeMessage());

  const { contentType } = normalizeVideoType(input.contentType || input.file.type);

 // 1. Mint a signed upload ticket (tiny JSON, immune to the body limit).
  const signRes = await fetch("/api/footage/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      briefId: input.briefId,
      sceneIndex: input.sceneIndex,
      contentType,
    }),
  });
  const ticket = await signRes.json().catch(() => ({}));
  if (!signRes.ok) throw new Error(ticket.error ?? "Could not start upload");
  const { path, signedUrl } = ticket as { path: string; token: string; signedUrl: string };

  // 2. PUT the file straight to Supabase, tracking progress. This mirrors supabase-js's
  //    uploadToSignedUrl wire format: PUT, multipart body { cacheControl, "": file }, x-upsert.
  await new Promise<void>((resolve, reject) => {
    const form = new FormData();
    form.append("cacheControl", "3600");
 // Supabase infers the stored object's content-type from this part's Blob type, re-wrap so a
    // quicktime clip lands as video/mp4 (matching the .mp4 path), not an unplayable quicktime .webm.
    const filePart =
      input.file.type === contentType ? input.file : new Blob([input.file], { type: contentType });
    form.append("", filePart);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    // Generous ceiling for large clips on slow links; without it a stalled
    // connection (no data, no error) would hang the upload UI forever.
    xhr.timeout = 10 * 60 * 1000;
 xhr.setRequestHeader("x-upsert", "true"); // do NOT set content-type, the browser sets the multipart boundary
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) input.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // Backstop for anything the pre-flight check missed, e.g. a stale tab running older
      // JS after the limit changed. A bare "Upload failed (413)" tells the user nothing.
      if (xhr.status === 413) return reject(new Error(tooLargeMessage()));
      reject(new Error(`Upload failed (${xhr.status})`));
    };
 xhr.onerror = () => reject(new Error("Upload failed, network error"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.send(form);
  });
  input.onProgress?.(1);

  // 3. Confirm: record the scene_footage row, get back the cache-busted public URL.
  const confirmRes = await fetch("/api/footage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      briefId: input.briefId,
      sceneIndex: input.sceneIndex,
      storagePath: path,
    }),
  });
  const confirm = await confirmRes.json().catch(() => ({}));
  if (!confirmRes.ok) throw new Error(confirm.error ?? "Could not finalize upload");
  return confirm.url as string;
}
