import { mkdir, copyFile, writeFile, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import type { JobState, RenderBrief, RenderJobInput, RenderProps } from "./types.js";
import { getCaptureWithScript, createTranscript, createRender, updateRender } from "./db.js";
import { extractAudio, buildCutVideo, compositeOverlay, probeVideo } from "./ffmpeg.js";
import { transcribeWords } from "./transcribe.js";
import { planCut } from "./cut.js";
import { remap } from "./remap.js";
import { buildKeywordCues, buildOverlayCues } from "./cues.js";
import { renderOverlay, RENDER_ROOT } from "./render.js";
import { getSupabaseAdmin, RENDER_BUCKET } from "./supabase.js";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(here, "../remotion/public");

export interface JobResult {
  mp4Url: string;
  /** Local output path (always written, even when also uploaded). */
  localPath: string;
  transcriptId?: string;
  renderId?: string;
  segments: number;
  durationMs: number;
}

async function fetchToFile(src: string, destPath: string): Promise<void> {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`download failed (${res.status}) for ${src}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(destPath, buf);
  } else {
    // local path or file:// — copy in
    await copyFile(src.replace(/^file:\/\//, ""), destPath);
  }
}

/**
 * The full render job (Phase 7-8). Resolves input -> transcribe -> cut -> remap ->
 * ffmpeg concat -> Remotion overlay render -> upload. `onStatus` lets the server stream
 * progress into its in-memory job table.
 */
export async function runJob(
  jobId: string,
  input: RenderJobInput,
  onStatus: (status: JobState["status"], extra?: Partial<JobState>) => void,
): Promise<JobResult> {
  // 1. Resolve the recording URL + brief, from DB (captureId) or directly (tests).
  let videoSrc: string;
  let brief: RenderBrief;
  let captureId: string | undefined;

  if (input.captureId) {
    const c = await getCaptureWithScript(input.captureId);
    videoSrc = c.videoUrl;
    brief = c.brief;
    captureId = c.captureId;
  } else {
    if (!input.videoUrl || !input.brief) {
      throw new Error("Provide either captureId, or both videoUrl and brief.");
    }
    videoSrc = input.videoUrl;
    brief = input.brief;
  }

  const workDir = join(RENDER_ROOT, "tmp", jobId);
  const outRel = `out/edited-${jobId}.mp4`;
  const outAbs = join(RENDER_ROOT, outRel);
  const overlayRel = `tmp/${jobId}/overlay.mov`;
  const overlayAbs = join(workDir, "overlay.mov");
  const propsRel = `tmp/${jobId}/props.json`;
  const propsAbs = join(workDir, "props.json");

  await mkdir(workDir, { recursive: true });
  await mkdir(join(RENDER_ROOT, "out"), { recursive: true });
  await mkdir(PUBLIC_DIR, { recursive: true });

  const recordingPath = join(workDir, "recording.input");
  const audioPath = join(workDir, "audio.mp3");
  const baseTmpPath = join(workDir, "base.mp4");

  try {
    // 2. Get the recording locally (ffmpeg reads webm/mp4/mov alike — no pre-transcode).
    await fetchToFile(videoSrc, recordingPath);

    // 3. Transcribe (word-level, whisper-1).
    onStatus("transcribing");
    await extractAudio(recordingPath, audioPath);
    const words = await transcribeWords(audioPath);

    let transcriptId: string | undefined;
    if (captureId) transcriptId = await createTranscript(captureId, words);

    // 4. Cut (filler + dead space) -> kept segments + kept words.
    onStatus("cutting");
    const plan = planCut(words);
    if (plan.segments.length === 0) throw new Error("cut produced no segments to keep");

    // 5. ffmpeg: cut + concat the kept segments into one clean clip.
    await buildCutVideo(recordingPath, plan.segments, baseTmpPath);
    const probe = await probeVideo(baseTmpPath);

    // 6. Remap word + overlay timing onto the post-cut timeline.
    const r = remap(plan.keptWords, plan.segments);
    const keywordCues = buildKeywordCues(r.words, brief.keywordFlags);
    const overlayCues = buildOverlayCues(r.words, brief.overlays ?? [], r.totalMs);

    // 7. Build props for the TRANSPARENT overlay render (baseVideoFile empty = no video
    //    mounted, so OffthreadVideo seeking can't fail).
    const props: RenderProps = {
      baseVideoFile: "",
      durationMs: probe.durationMs || r.totalMs,
      width: probe.width,
      height: probe.height,
      words: r.words,
      keywordCues,
      overlayCues,
      accentColor: brief.accentColor,
    };
    await writeFile(propsAbs, JSON.stringify(props));

    // 8. Render the caption/overlay layer (ProRes 4444, alpha), then ffmpeg-burn it onto
    //    the cut base clip -> edited.mp4.
    onStatus("rendering");
    let renderId: string | undefined;
    if (transcriptId) renderId = await createRender(transcriptId);
    await renderOverlay(propsRel, overlayRel);
    await compositeOverlay(baseTmpPath, overlayAbs, outAbs);

    // 9. Upload (when DB-backed) + always keep the local file.
    onStatus("uploading");
    let mp4Url = outAbs;
    if (renderId) {
      try {
        const supabase = getSupabaseAdmin();
        const fileBuf = await readFile(outAbs);
        const storagePath = `${renderId}.mp4`;
        const up = await supabase.storage
          .from(RENDER_BUCKET)
          .upload(storagePath, fileBuf, { contentType: "video/mp4", upsert: true });
        if (up.error) throw up.error;
        mp4Url = supabase.storage.from(RENDER_BUCKET).getPublicUrl(storagePath).data.publicUrl;
        await updateRender(renderId, { status: "done", mp4Url });
      } catch (e) {
        await updateRender(renderId, { status: "error" });
        throw new Error(`upload failed: ${(e as Error).message}`);
      }
    }

    onStatus("done", { mp4Url, renderId });
    return {
      mp4Url,
      localPath: outAbs,
      transcriptId,
      renderId,
      segments: plan.segments.length,
      durationMs: props.durationMs,
    };
  } finally {
    // Drop the large ProRes overlay; keep edited.mp4 + props for debugging.
    await rm(overlayAbs, { force: true });
  }
}
