import { mkdir, copyFile, writeFile, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import type { JobState, RenderBrief, RenderJobInput, RenderProps } from "./types.js";
import { getCaptureWithScript, createTranscript, createRender, updateRender } from "./db.js";
import { extractAudio, buildCutVideo, compositeOverlay, probeVideo, concatClips } from "./ffmpeg.js";
import { transcribeWords, scriptToVocabPrompt } from "./transcribe.js";
import { planCut } from "./cut.js";
import { remap } from "./remap.js";
import { buildKeywordCues, buildOverlayCues } from "./cues.js";
import { cleanTerms } from "./terms.js";
import { renderOverlay, RENDER_ROOT } from "./render.js";
import { runPremium } from "./premium/index.js";
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
  let videoSrc: string | undefined;
  let videoUrls: string[] | undefined;
  let brief: RenderBrief;
  let captureId: string | undefined;

  if (input.captureId) {
    const c = await getCaptureWithScript(input.captureId);
    videoSrc = c.videoUrl;
    brief = c.brief;
    captureId = c.captureId;
  } else if (input.videoUrls?.length && input.brief) {
    // Multiple per-scene clips: concatenated into one take below.
    videoUrls = input.videoUrls;
    brief = input.brief;
  } else {
    if (!input.videoUrl || !input.brief) {
      throw new Error("Provide captureId, or videoUrl+brief, or videoUrls[]+brief.");
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

  let recordingPath = join(workDir, "recording.input");
  const audioPath = join(workDir, "audio.mp3");
  const baseTmpPath = join(workDir, "base.mp4");

  try {
    // 2. Get the recording locally (ffmpeg reads webm/mp4/mov alike — no pre-transcode).
    //    Multiple per-scene clips are fetched and concatenated into one take first.
    if (videoUrls?.length) {
      const clipPaths: string[] = [];
      for (let i = 0; i < videoUrls.length; i++) {
        const clipPath = join(workDir, `clip-${i}.input`);
        await fetchToFile(videoUrls[i], clipPath);
        clipPaths.push(clipPath);
      }
      recordingPath = join(workDir, "recording.mp4");
      await concatClips(clipPaths, recordingPath);
    } else {
      await fetchToFile(videoSrc as string, recordingPath);
    }

    // 3. Transcribe (word-level, whisper-1).
    onStatus("transcribing");
    await extractAudio(recordingPath, audioPath);
    // Bias whisper with a compact VOCABULARY hint (product names, acronyms, keyword flags)
    // mined from the whole script — not a raw prefix, which would miss late terms and bias
    // decoding toward early lines the speaker may have skipped/reworded.
    const vocab = scriptToVocabPrompt(
      brief.script,
      brief.keywordFlags.map((f) => f.phrase),
    );
    const words = await transcribeWords(audioPath, vocab);

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
    const captionWords = cleanTerms(r.words); // fix technical terms (Trigger.dev, Next.js, ...)
    const keywordCues = buildKeywordCues(captionWords, brief.keywordFlags);
    const overlayCues = buildOverlayCues(captionWords, brief.overlays ?? [], r.totalMs);

    // 7. Build props for the TRANSPARENT overlay render (baseVideoFile empty = no video
    //    mounted, so OffthreadVideo seeking can't fail).
    const props: RenderProps = {
      baseVideoFile: "",
      durationMs: probe.durationMs || r.totalMs,
      width: probe.width,
      height: probe.height,
      words: captionWords,
      keywordCues,
      overlayCues,
      accentColor: brief.accentColor,
    };
    await writeFile(propsAbs, JSON.stringify(props));

    // 8. Render the caption/overlay layer (ProRes 4444, alpha), then ffmpeg-burn it onto
    //    the cut base clip -> captioned.mp4 (the fixed-component output = the premium fallback).
    onStatus("rendering");
    let renderId: string | undefined;
    if (transcriptId) renderId = await createRender(transcriptId);
    await renderOverlay(propsRel, overlayRel);
    const captionedAbs = join(workDir, "captioned.mp4");
    await compositeOverlay(baseTmpPath, overlayAbs, captionedAbs);

    // 8b. Premium tier: layer bespoke GPT-authored scenes (storyboard -> HyperFrames HTML ->
    //     vision-QA loop) on top of the captioned base. Any failure or timeout falls back to
    //     the fixed-component output, so the user always gets a video.
    if (input.premium) {
      try {
        const pr = await runPremium({
          basePath: captionedAbs,
          outPath: outAbs,
          brief,
          words: captionWords,
          durationMs: props.durationMs,
          workDir,
          log: (m) => console.log(`[premium ${jobId}] ${m}`),
        });
        console.log(`[premium ${jobId}] composited ${pr.sceneCount} bespoke scene(s)`);
      } catch (e) {
        console.warn(
          `[premium ${jobId}] failed, using fixed-component render: ${(e as Error).message}`,
        );
        await copyFile(captionedAbs, outAbs);
      }
    } else {
      await copyFile(captionedAbs, outAbs);
    }

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
