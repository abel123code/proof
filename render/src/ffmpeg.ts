import { spawn } from "node:child_process";
import { copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { KeepSegment } from "./types.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export const SPEAKER_SAFE_ALPHA_FILTER =
  "format=rgba," +
  "drawbox=x=0:y=1450:w=iw:h=470:color=black@0:t=fill:replace=1," +
  "format=yuva444p10le";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}:\n${stderr.slice(-1200)}`)),
    );
  });
}

function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${cmd} exited ${code}:\n${stderr.slice(-1200)}`)),
    );
  });
}

/**
 * Clear authored pixels only over the burned-in caption band. Face overlap remains visible:
 * readable essential wording takes priority, and vision QA judges the resulting composition.
 */
export async function maskOverlaySafeZones(overlayPath: string): Promise<void> {
  const maskedPath = `${overlayPath}.speaker-safe.mov`;
  try {
    await run(FFMPEG, [
      "-y",
      "-i", overlayPath,
      "-vf", SPEAKER_SAFE_ALPHA_FILTER,
      "-an",
      "-c:v", "prores_ks",
      "-profile:v", "4",
      "-pix_fmt", "yuva444p10le",
      maskedPath,
    ]);
    await copyFile(maskedPath, overlayPath);
  } finally {
    await rm(maskedPath, { force: true });
  }
}

/** Extract mono 16kHz mp3 audio — small, fast, well under Whisper's 25MB limit. */
export async function extractAudio(videoPath: string, outPath: string): Promise<void> {
  await run(FFMPEG, [
    "-y", "-i", videoPath,
    "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "libmp3lame", "-b:a", "64k",
    outPath,
  ]);
}

/** Normalize any container (e.g. webm from MediaRecorder) to H.264 mp4. */
export async function transcodeToMp4(inputPath: string, outPath: string): Promise<void> {
  await run(FFMPEG, [
    "-y", "-i", inputPath,
    "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-r", "30", "-fps_mode", "cfr", "-movflags", "+faststart",
    outPath,
  ]);
}

/**
 * Concatenate multiple per-scene clips (recorded/uploaded separately, possibly different
 * containers, codecs and resolutions) into one continuous take. Each input is scaled and
 * padded to a common 1080x1920 H.264 CFR30 frame inside a single filter_complex, then
 * concatenated. The result is a normal recording the rest of the pipeline can transcribe
 * and cut as if it were one take.
 */
export async function concatClips(inputPaths: string[], outPath: string): Promise<void> {
  if (inputPaths.length === 0) throw new Error("concatClips: no inputs");
  if (inputPaths.length === 1) {
    // Single clip: just normalize it to the canonical format.
    await transcodeToMp4(inputPaths[0], outPath);
    return;
  }

  const inputArgs: string[] = [];
  inputPaths.forEach((p) => {
    inputArgs.push("-i", p);
  });

  const parts: string[] = [];
  const concatInputs: string[] = [];
  inputPaths.forEach((_, i) => {
    // Scale to fit inside 1080x1920, pad to exact size, force 30fps + SAR 1; resample
    // audio to a common rate so the concat filter accepts every stream.
    parts.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
    parts.push(`[${i}:a]aresample=48000,asetpts=N/SR/TB[a${i}]`);
    concatInputs.push(`[v${i}][a${i}]`);
  });
  const filter =
    `${parts.join(";")};` +
    `${concatInputs.join("")}concat=n=${inputPaths.length}:v=1:a=1[outv][outa]`;

  await run(FFMPEG, [
    "-y",
    ...inputArgs,
    "-filter_complex", filter,
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-r", "30", "-fps_mode", "cfr",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    outPath,
  ]);
}

/**
 * Cut the kept segments out of the source and concatenate them back-to-back into one
 * clean clip. Single filter_complex pass (trim + setpts + concat) = frame-accurate, no
 * intermediate files. Remotion then overlays captions on this single clip.
 */
export async function buildCutVideo(
  inputPath: string,
  segments: KeepSegment[],
  outPath: string,
): Promise<void> {
  if (segments.length === 0) throw new Error("buildCutVideo: no segments to keep");

  const parts: string[] = [];
  const concatInputs: string[] = [];
  segments.forEach((s, i) => {
    const start = (s.startMs / 1000).toFixed(3);
    const end = (s.endMs / 1000).toFixed(3);
    parts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
    concatInputs.push(`[v${i}][a${i}]`);
  });
  const filter =
    `${parts.join(";")};` +
    `${concatInputs.join("")}concat=n=${segments.length}:v=1:a=1[outv][outa]`;

  await run(FFMPEG, [
    "-y", "-i", inputPath,
    "-filter_complex", filter,
    "-map", "[outv]", "-map", "[outa]",
    // Remotion only renders a transparent graphics layer, so this intermediate no longer
    // needs every frame to be a keyframe for OffthreadVideo seeking.
    "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p",
    "-r", "30", "-fps_mode", "cfr",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    outPath,
  ]);
}

/**
 * Burn a transparent overlay layer (ProRes 4444 .mov with alpha) onto the cut base clip.
 * Keeps the base audio. This is the final edited.mp4.
 */
export async function compositeOverlay(
  basePath: string,
  overlayPath: string,
  outPath: string,
): Promise<void> {
  await run(FFMPEG, [
    "-y",
    "-i", basePath,
    "-i", overlayPath,
    "-filter_complex", "[0:v][1:v]overlay=format=auto[v]",
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-r", "30", "-fps_mode", "cfr",
    "-af", "highpass=f=80,afftdn=nf=-25,acompressor=threshold=-18dB:ratio=3:attack=15:release=180,loudnorm=I=-14:LRA=7:TP=-1.5",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    outPath,
  ]);
}

/** Composite a time slice from a full-length transparent overlay onto a reset-to-zero base window. */
export async function compositeOverlaySlice(
  basePath: string,
  overlayPath: string,
  startMs: number,
  durationMs: number,
  outPath: string,
): Promise<void> {
  await run(FFMPEG, [
    "-y",
    "-i", basePath,
    "-ss", (startMs / 1000).toFixed(3),
    "-t", (durationMs / 1000).toFixed(3),
    "-i", overlayPath,
    "-filter_complex", "[0:v][1:v]overlay=format=auto:eof_action=pass[v]",
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-r", "30", "-fps_mode", "cfr",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    outPath,
  ]);
}

/**
 * Extract still PNG frames at the given timestamps (seconds). Used by the premium vision-QA
 * pass — a handful of frames per scene is enough for GPT-4o to judge it. One ffmpeg call per
 * frame keeps seeking exact (accurate `-ss` before `-i`).
 */
export async function extractFrames(
  videoPath: string,
  timesSec: number[],
  outDir: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < timesSec.length; i++) {
    const out = join(outDir, `${prefix}-${i}.png`);
    await run(FFMPEG, [
      "-y",
      "-ss", Math.max(0, timesSec[i]).toFixed(3),
      "-i", videoPath,
      "-frames:v", "1", "-q:v", "2",
      out,
    ]);
    paths.push(out);
  }
  return paths;
}

/**
 * Composite N transparent scene MOVs onto the base clip, each starting at its own offset and
 * visible only for its window. Every scene input is time-shifted (setpts +start/TB) so its
 * frame 0 lands at `startMs`, then overlaid with enable=between(t,start,end). This is the
 * premium analogue of compositeOverlay (which burns a single full-length overlay).
 */
export async function overlayScenesAtOffsets(
  basePath: string,
  scenes: {
    movPath: string;
    startMs: number;
    endMs: number;
    backgroundTreatment?: "footage" | "black";
  }[],
  outPath: string,
): Promise<void> {
  if (scenes.length === 0) throw new Error("overlayScenesAtOffsets: no scenes");

  const inputs: string[] = ["-i", basePath];
  scenes.forEach((s) => inputs.push("-i", s.movPath));

  const parts: string[] = [];
  let prev = "[0:v]";
  scenes.forEach((s, i) => {
    const startS = (s.startMs / 1000).toFixed(3);
    const endS = (s.endMs / 1000).toFixed(3);
    const inIdx = i + 1;
    parts.push(`[${inIdx}:v]setpts=PTS-STARTPTS+${startS}/TB[m${i}]`);
    let sceneBase = prev;
    if (s.backgroundTreatment === "black") {
      const blackLabel = `[b${i}]`;
      parts.push(
        `${prev}drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,${startS},${endS})'${blackLabel}`,
      );
      sceneBase = blackLabel;
    }
    const outLbl = i === scenes.length - 1 ? "[v]" : `[v${i}]`;
    parts.push(
      `${sceneBase}[m${i}]overlay=format=auto:eof_action=pass:enable='between(t,${startS},${endS})'${outLbl}`,
    );
    prev = outLbl;
  });

  await run(FFMPEG, [
    "-y",
    ...inputs,
    "-filter_complex", parts.join(";"),
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-r", "30", "-fps_mode", "cfr",
    "-af", "highpass=f=80,afftdn=nf=-25,acompressor=threshold=-18dB:ratio=3:attack=15:release=180,loudnorm=I=-14:LRA=7:TP=-1.5",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    outPath,
  ]);
}

/** Probe pixel dimensions + duration so the composition matches the cut clip exactly. */
export async function probeVideo(
  path: string,
): Promise<{ width: number; height: number; durationMs: number }> {
  const out = await runCapture(FFPROBE, [
    "-v", "error",
    "-print_format", "json",
    "-show_format", "-show_streams",
    path,
  ]);
  const json = JSON.parse(out) as {
    streams: { codec_type: string; width?: number; height?: number }[];
    format: { duration?: string };
  };
  const v = json.streams.find((s) => s.codec_type === "video");
  return {
    width: v?.width ?? 1080,
    height: v?.height ?? 1920,
    durationMs: Math.round(parseFloat(json.format?.duration ?? "0") * 1000),
  };
}
