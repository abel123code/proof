import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { composeCreatorNativeVideo } from "../src/premium/compose.js";
import type { AuthoredScene } from "../src/types.js";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

function pixelAt(video: string, time: number, x: number, y: number): Buffer {
  return execFileSync(ffmpeg, [
    "-loglevel", "error", "-ss", String(time), "-i", video,
    "-vf", `crop=2:2:${x}:${y}`,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ]);
}

test("creator-native composition keeps opaque full-frame visuals below captions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "creator-compose-"));
  const base = join(dir, "base.mp4");
  const scene = join(dir, "scene.mov");
  const captions = join(dir, "captions.mov");
  const visual = join(dir, "visual.mp4");
  const out = join(dir, "final.mp4");
  try {
    execFileSync(ffmpeg, [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=1080x1920:r=30:d=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", base,
    ]);
    execFileSync(ffmpeg, [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=blue@1:s=1080x1920:r=30:d=1",
      "-vf", "format=rgba,format=yuva444p10le",
      "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", scene,
    ]);
    execFileSync(ffmpeg, [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=black@0:s=1080x1920:r=30:d=3",
      "-vf", "format=rgba,colorchannelmixer=aa=0,drawbox=x=100:y=1600:w=880:h=200:color=green@1:t=fill:replace=1,format=yuva444p10le",
      "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", captions,
    ]);

    const authored: AuthoredScene[] = [{
      spec: {
        id: "scene-1", anchorMs: 1000, durMs: 1000, mode: "full-frame", priority: 100,
        rationale: "test", motif: "none", intent: "blue frame", captionText: "caption",
      },
      html: "",
      movPath: scene,
      report: {
        sceneId: "scene-1", anchorMs: 1000, durMs: 1000, mode: "full-frame", rationale: "test",
        intent: "blue frame", verdict: "clean", shipped: true, issues: [], attempts: 1,
      },
    }];

    const count = await composeCreatorNativeVideo({
      basePath: base,
      scenes: authored,
      captionOverlayPath: captions,
      visualPath: visual,
      outPath: out,
    });
    assert.equal(count, 1);

    const center = pixelAt(out, 1.5, 540, 900);
    assert.ok(center[2] > center[0] && center[2] > center[1], "full-frame scene should own the center");
    const caption = pixelAt(out, 1.5, 540, 1700);
    assert.ok(caption[1] > caption[0] && caption[1] > caption[2], "caption layer must remain above the scene");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("blackout treatment hard-cuts the footage while preserving scene alpha, captions, and audio", async () => {
  const dir = await mkdtemp(join(tmpdir(), "creator-blackout-"));
  const base = join(dir, "base.mp4");
  const scene = join(dir, "scene.mov");
  const captions = join(dir, "captions.mov");
  const visual = join(dir, "visual.mp4");
  const out = join(dir, "final.mp4");
  try {
    execFileSync(ffmpeg, [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=1080x1920:r=30:d=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", base,
    ]);
    execFileSync(ffmpeg, [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=black@0:s=1080x1920:r=30:d=1",
      "-vf", "format=rgba,colorchannelmixer=aa=0,drawbox=x=390:y=760:w=300:h=300:color=blue@1:t=fill:replace=1,format=yuva444p10le",
      "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", scene,
    ]);
    execFileSync(ffmpeg, [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=black@0:s=1080x1920:r=30:d=3",
      "-vf", "format=rgba,colorchannelmixer=aa=0,drawbox=x=100:y=1600:w=880:h=200:color=green@1:t=fill:replace=1,format=yuva444p10le",
      "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", captions,
    ]);

    const authored: AuthoredScene[] = [{
      spec: {
        id: "scene-black", anchorMs: 1000, durMs: 1000, mode: "full-frame",
        backgroundTreatment: "black", priority: 100, rationale: "sole focus", motif: "none",
        intent: "blue square", captionText: "caption",
      },
      html: "",
      movPath: scene,
      report: {
        sceneId: "scene-black", anchorMs: 1000, durMs: 1000, mode: "full-frame",
        backgroundTreatment: "black", rationale: "sole focus", intent: "blue square",
        verdict: "clean", shipped: true, issues: [], attempts: 1,
      },
    }];

    await composeCreatorNativeVideo({
      basePath: base,
      scenes: authored,
      captionOverlayPath: captions,
      visualPath: visual,
      outPath: out,
    });

    const before = pixelAt(out, 0.5, 100, 900);
    assert.ok(before[0] > before[1] && before[0] > before[2], "footage must remain before the hard cut");
    const blackout = pixelAt(out, 1.5, 100, 900);
    assert.ok(blackout[0] < 20 && blackout[1] < 20 && blackout[2] < 20, "transparent scene area must become black");
    const graphic = pixelAt(out, 1.5, 540, 900);
    assert.ok(graphic[2] > graphic[0] && graphic[2] > graphic[1], "the alpha scene must render above black");
    const caption = pixelAt(out, 1.5, 540, 1700);
    assert.ok(caption[1] > caption[0] && caption[1] > caption[2], "captions must remain above blackout scenes");
    const after = pixelAt(out, 2.5, 100, 900);
    assert.ok(after[0] > after[1] && after[0] > after[2], "footage must return immediately after the hard cut");
    const audioCodec = execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name",
      "-of", "default=noprint_wrappers=1:nokey=1", out,
    ], { encoding: "utf8" }).trim();
    assert.ok(audioCodec.length > 0, "base audio must continue through the blackout");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("creator-native composition treats zero enhanced scenes as intentional clean A-roll", async () => {
  const dir = await mkdtemp(join(tmpdir(), "creator-clean-"));
  const base = join(dir, "base.mp4");
  const captions = join(dir, "captions.mov");
  const visual = join(dir, "visual.mp4");
  const out = join(dir, "final.mp4");
  try {
    execFileSync(ffmpeg, [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=1080x1920:r=30:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", base,
    ]);
    execFileSync(ffmpeg, [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=black@0:s=1080x1920:r=30:d=1",
      "-vf", "format=rgba,colorchannelmixer=aa=0,drawbox=x=100:y=1600:w=880:h=200:color=green@1:t=fill:replace=1,format=yuva444p10le",
      "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", captions,
    ]);
    const count = await composeCreatorNativeVideo({
      basePath: base,
      scenes: [],
      captionOverlayPath: captions,
      visualPath: visual,
      outPath: out,
    });
    assert.equal(count, 0);
    const center = pixelAt(out, 0.5, 540, 900);
    assert.ok(center[0] > center[1] && center[0] > center[2], "clean A-roll must preserve the base footage");
    const caption = pixelAt(out, 0.5, 540, 1700);
    assert.ok(caption[1] > caption[0] && caption[1] > caption[2], "captions must still be burned over clean A-roll");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
