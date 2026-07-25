import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mixMusicUnderVoice, hasAudioStream, probeVideo } from "../src/ffmpeg.js";
import {
  loadMusicLibrary,
  pickDefaultTrack,
  parseMusicChoice,
  soundtrack,
  DEFAULT_MIX,
  type Track,
} from "../src/soundtrack.js";
import type { RenderBrief } from "../src/types.js";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

const brief: RenderBrief = { script: "hello there", keywordFlags: [] };

/** A base "video" = 1080x1920 color + a sine "voice" track. */
function makeVideo(path: string, durSec: number): void {
  execFileSync(ffmpeg, [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=red:s=1080x1920:r=30:d=${durSec}`,
    "-f", "lavfi", "-i", `sine=frequency=300:duration=${durSec}`,
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path,
  ]);
}

function makeTrack(path: string, durSec: number): void {
  execFileSync(ffmpeg, [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=180:duration=${durSec}`,
    "-c:a", "libmp3lame", "-b:a", "128k", path,
  ]);
}

test("mixMusicUnderVoice keeps video length, loops a short track, and preserves an audio stream", async () => {
  const dir = await mkdtemp(join(tmpdir(), "music-mix-"));
  const video = join(dir, "in.mp4");
  const track = join(dir, "bed.mp3"); // 1s -> must be looped to cover the 3s video
  const out = join(dir, "out.mp4");
  try {
    makeVideo(video, 3);
    makeTrack(track, 1);
    await mixMusicUnderVoice(video, track, out, {
      musicGainDb: -20,
      duckAmountDb: 10,
      fadeInMs: 500,
      fadeOutMs: 800,
      videoDurationMs: 3000,
    });
    assert.ok(await hasAudioStream(out), "mixed output must have an audio stream");
    const { durationMs } = await probeVideo(out);
    assert.ok(Math.abs(durationMs - 3000) < 400, `duration should track the video (~3000ms), got ${durationMs}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadMusicLibrary returns [] for a missing folder and validates entries against real files", async () => {
  assert.deepEqual(loadMusicLibrary(join(tmpdir(), "does-not-exist-xyz")), []);

  const dir = await mkdtemp(join(tmpdir(), "music-lib-"));
  try {
    makeTrack(join(dir, "real.mp3"), 1);
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({
        tracks: [
          { id: "real", file: "real.mp3", mood: ["calm"], title: "Real" },
          { id: "ghost", file: "missing.mp3", mood: ["calm"] }, // file absent -> dropped
          { file: "no-id.mp3" }, // no id -> dropped
        ],
      }),
    );
    const lib = loadMusicLibrary(dir);
    assert.equal(lib.length, 1, "only the entry with a real file + id survives");
    assert.equal(lib[0].id, "real");
    assert.ok(lib[0].path.endsWith("real.mp3"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadMusicLibrary returns [] when the manifest is malformed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "music-bad-"));
  try {
    await writeFile(join(dir, "manifest.json"), "{ not json");
    assert.deepEqual(loadMusicLibrary(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pickDefaultTrack prefers a minimal/calm bed, else the first track", () => {
  const t = (id: string, mood: string[]): Track => ({ id, file: `${id}.mp3`, mood, path: `/x/${id}.mp3` });
  assert.equal(pickDefaultTrack([t("a", ["uplifting"]), t("b", ["calm"])])?.id, "b");
  assert.equal(pickDefaultTrack([t("a", ["uplifting"]), t("c", ["bright"])])?.id, "a");
  assert.equal(pickDefaultTrack([]), undefined);
});

test("parseMusicChoice rejects bad JSON / unknown ids and clamps out-of-range mix values", () => {
  const ids = new Set(["calm", "warm"]);
  assert.equal(parseMusicChoice("not json", ids), null);
  assert.equal(parseMusicChoice(JSON.stringify({ trackId: "unknown" }), ids), null);
  assert.equal(parseMusicChoice(null, ids), null);

  const ok = parseMusicChoice(
    JSON.stringify({ trackId: "warm", musicGainDb: -999, duckAmountDb: 100, fadeInMs: -50, fadeOutMs: 99999 }),
    ids,
  );
  assert.ok(ok);
  assert.equal(ok!.trackId, "warm");
  assert.equal(ok!.mix.musicGainDb, -12); // clamped low
  assert.equal(ok!.mix.duckAmountDb, 10); // clamped high
  assert.equal(ok!.mix.fadeInMs, 0); // clamped low
  assert.equal(ok!.mix.fadeOutMs, 6000); // clamped high

  // Missing numeric fields fall back to the safe defaults.
  const partial = parseMusicChoice(JSON.stringify({ trackId: "calm" }), ids);
  assert.deepEqual(partial!.mix, DEFAULT_MIX);
});

test("soundtrack no-ops (byte-identical) when RENDER_MUSIC=0 or the library is empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "music-noop-"));
  const video = join(dir, "v.mp4");
  const prev = process.env.RENDER_MUSIC;
  try {
    makeVideo(video, 1);
    const before = await readFile(video);

    // Disabled flag: returns before touching anything.
    process.env.RENDER_MUSIC = "0";
    await soundtrack({ videoPath: video, brief, words: [], musicDir: dir });
    assert.deepEqual(await readFile(video), before, "RENDER_MUSIC=0 must leave the file untouched");

    // Enabled but empty library (dir has no manifest): still a no-op.
    process.env.RENDER_MUSIC = "1";
    await soundtrack({ videoPath: video, brief, words: [], musicDir: dir });
    assert.deepEqual(await readFile(video), before, "empty library must leave the file untouched");
  } finally {
    if (prev === undefined) delete process.env.RENDER_MUSIC;
    else process.env.RENDER_MUSIC = prev;
    await rm(dir, { recursive: true, force: true });
  }
});
