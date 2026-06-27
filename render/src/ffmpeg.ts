import { spawn } from "node:child_process";
import type { KeepSegment } from "./types.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

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
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
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
    // Constant 30fps + ALL keyframes (-bf 0 -g 1) + faststart. Every frame being a
    // keyframe makes any timestamp directly seekable, which is what Remotion's
    // OffthreadVideo needs — sparse keyframes trigger "No frame found at position".
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-r", "30", "-fps_mode", "cfr",
    "-bf", "0", "-g", "1", "-keyint_min", "1",
    "-c:a", "aac",
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
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-r", "30", "-fps_mode", "cfr",
    "-c:a", "aac",
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
