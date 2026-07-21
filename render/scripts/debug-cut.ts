// Diagnose the cut clip in isolation: transcribe -> plan -> ffmpeg cut, keep the file,
// print the plan, and report duration/frames so we can see if the concat is malformed.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { extractAudio, buildCutVideo, probeVideo } from "../src/ffmpeg.js";
import { transcribeWords } from "../src/transcribe.js";
import { planCut } from "../src/cut.js";

const SRC = process.argv[2];
const OUT = process.argv[3] ?? join(process.cwd(), "out", "debug-base.mp4");

if (!SRC) {
  console.error("usage: tsx scripts/debug-cut.ts <source-video> [output-video]");
  process.exit(1);
}

function sh(cmd: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let o = "", e = "";
    p.stdout.on("data", (d) => (o += d));
    p.stderr.on("data", (d) => (e += d));
    p.on("close", (c) => (c === 0 ? res(o + e) : rej(new Error(e))));
  });
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "proof-dbg-"));
  const audio = join(dir, "a.mp3");
  await extractAudio(SRC, audio);
  const words = await transcribeWords(audio);
  const plan = planCut(words);
  console.log(`words=${words.length} kept=${plan.keptWords.length} segments=${plan.segments.length}`);
  console.log("segments (ms):", plan.segments.map((s) => `${Math.round(s.startMs)}-${Math.round(s.endMs)}`).join("  "));

  await buildCutVideo(SRC, plan.segments, OUT);
  const probe = await probeVideo(OUT);
  console.log(`\nbase clip -> ${OUT}`);
  console.log(`probe: ${probe.width}x${probe.height}  ${(probe.durationMs / 1000).toFixed(2)}s`);

  // stream-level: count frames + check video/audio durations separately
  const info = await sh("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-count_frames", "-show_entries", "stream=nb_read_frames,duration,avg_frame_rate",
    "-of", "default=noprint_wrappers=1", OUT,
  ]);
  console.log("video stream:", info.trim());
  const adur = await sh("ffprobe", [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=duration", "-of", "default=noprint_wrappers=1", OUT,
  ]);
  console.log("audio:", adur.trim());

  // decode integrity: re-decode whole file to null, surface any errors
  console.log("\ndecode-integrity check (ffmpeg -f null):");
  const dec = await sh("ffmpeg", ["-v", "error", "-i", OUT, "-f", "null", "-"]);
  console.log(dec.trim() ? dec.trim() : "  clean (no decode errors)");
}

main().catch((e) => {
  console.error("debug-cut FAILED:", e);
  process.exit(1);
});
