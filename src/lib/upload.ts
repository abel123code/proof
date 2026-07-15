/**
 * Normalize a video mime to a browser-playable container label.
 *
 * Phones/screen-recorders report H.264 clips as `video/quicktime` (a .mov). Storing them raw
 * (as a `.webm` with a quicktime content-type — the old mapping) makes the in-app <video> preview
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
  const { contentType } = normalizeVideoType(input.contentType || input.file.type);

  // 1. Mint a signed upload ticket (tiny JSON — immune to the body limit).
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
    // Supabase infers the stored object's content-type from this part's Blob type — re-wrap so a
    // quicktime clip lands as video/mp4 (matching the .mp4 path), not an unplayable quicktime .webm.
    const filePart =
      input.file.type === contentType ? input.file : new Blob([input.file], { type: contentType });
    form.append("", filePart);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    // Generous ceiling for large clips on slow links; without it a stalled
    // connection (no data, no error) would hang the upload UI forever.
    xhr.timeout = 10 * 60 * 1000;
    xhr.setRequestHeader("x-upsert", "true"); // do NOT set content-type — the browser sets the multipart boundary
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) input.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed — network error"));
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

/**
 * Upload one brand-asset image (screenshot / logo) straight to Supabase via a signed ticket and
 * return its public URL. Unlike footage there's no DB row per image — the caller collects the URLs
 * and persists them together onto the brief (POST /api/assets). Mirrors the footage wire format.
 */
export async function uploadAssetDirect(input: {
  briefId: string;
  file: File;
  onProgress?: (fraction: number) => void;
}): Promise<string> {
  const signRes = await fetch("/api/assets/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      briefId: input.briefId,
      filename: input.file.name,
      contentType: input.file.type || "image/png",
    }),
  });
  const ticket = await signRes.json().catch(() => ({}));
  if (!signRes.ok) throw new Error(ticket.error ?? "Could not start upload");
  const { signedUrl, publicUrl } = ticket as { signedUrl: string; publicUrl: string };

  await new Promise<void>((resolve, reject) => {
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", input.file);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.timeout = 5 * 60 * 1000;
    xhr.setRequestHeader("x-upsert", "true"); // browser sets the multipart content-type/boundary
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) input.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed — network error"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.send(form);
  });
  input.onProgress?.(1);
  return publicUrl;
}
