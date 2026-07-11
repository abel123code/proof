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
  const contentType = input.contentType || input.file.type || "video/webm";

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
    form.append("", input.file);
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
