import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { analyzeVideoStructure } from "@/lib/gemini";
import { fetchDownloadableUrl } from "@/lib/apify";
import {
  getReferenceVideo,
  saveReferenceStructure,
  setReferenceStatus,
} from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Download a remote video to a temp file and return its path. */
async function downloadToTemp(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download video (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = path.join(os.tmpdir(), `ref-${randomUUID()}.mp4`);
  await fs.writeFile(file, buf);
  return file;
}

export async function POST(req: Request) {
  let tempFile: string | null = null;
  let referenceVideoId: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    referenceVideoId = typeof body?.referenceVideoId === "string" ? body.referenceVideoId : undefined;
    if (!referenceVideoId) {
      return NextResponse.json({ error: "referenceVideoId is required" }, { status: 400 });
    }

    const video = await getReferenceVideo(referenceVideoId);
    if (!video) {
      return NextResponse.json({ error: "reference video not found" }, { status: 404 });
    }

    await setReferenceStatus(referenceVideoId, "analyzing");

    // Pool rows are metadata-only; fetch a real downloadable URL on demand.
    const downloadUrl = video.downloadUrl ?? (await fetchDownloadableUrl(video.url));
    if (!downloadUrl) {
      await setReferenceStatus(referenceVideoId, "error").catch(() => {});
      return NextResponse.json(
        { error: "could not obtain a downloadable video URL for this clip" },
        { status: 422 },
      );
    }

    tempFile = await downloadToTemp(downloadUrl);
    const structure = await analyzeVideoStructure(tempFile);

    await saveReferenceStructure(referenceVideoId, structure);

    return NextResponse.json({ id: referenceVideoId, structure });
  } catch (err) {
    if (referenceVideoId) {
      await setReferenceStatus(referenceVideoId, "error").catch(() => {});
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (tempFile) await fs.unlink(tempFile).catch(() => {});
  }
}
