import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, copyFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CAPTION_ZONE_TOP_Y,
  captionIntrusionIssue,
  overlayIntrudesCaptionBand,
} from "../src/premium/caption-guard.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = spawnSync(FFMPEG, ["-version"]).status === 0;

// Caption token values from render/remotion/tokens.ts (hardcoded here to avoid a fragile
// cross-package import; keep in sync with SUBTITLE if those tokens change).
const SUBTITLE = { bottomOffset: 260, fontSize: 44, padV: 12 };

// Produce a prores-4444 (yuva) overlay clip that is fully TRANSPARENT except for an alpha box at
// [y, y+h]. colorchannelmixer=aa=0 zeroes the alpha plane first (the `color` source has no alpha, so
// format=rgba would otherwise fill it opaque); drawbox replace=1 then writes the box's alpha. This
// mirrors the genuine per-region alpha of a real HyperFrames overlay MOV.
function makeAlphaBox(mov: string, y: number, h: number, alpha: number): void {
  const r = spawnSync(FFMPEG, [
    "-y", "-f", "lavfi", "-i", "color=red:s=1080x1920:d=0.5:r=10",
    "-vf", `format=rgba,colorchannelmixer=aa=0,drawbox=x=0:y=${y}:w=1080:h=${h}:color=red@${alpha}:t=fill:replace=1,format=yuva444p10le`,
    "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", mov,
  ]);
  assert.equal(r.status, 0, r.stderr?.toString());
}

test("CAPTION_ZONE_TOP_Y stays at or above the caption pill top (derived from tokens, not magic)", () => {
  const pillBottom = 1920 - SUBTITLE.bottomOffset; // 1660
  const twoLinePillTop = pillBottom - (SUBTITLE.fontSize * 2 + SUBTITLE.padV * 2 + 40); // generous 2-line
  assert.ok(
    CAPTION_ZONE_TOP_Y <= twoLinePillTop,
    `zone top ${CAPTION_ZONE_TOP_Y} must be at/above the pill top ${twoLinePillTop}`,
  );
  assert.ok(CAPTION_ZONE_TOP_Y >= 1200, "not absurdly high (would waste the frame)");
});

test("captionIntrusionIssue is a SAFETY-tagged, concrete 'move it up' edit naming the zone", () => {
  const i = captionIntrusionIssue();
  assert.equal(i.kind, "safety", "covering the captions is objective, not a matter of taste");
  assert.match(i.text, /caption/i);
  assert.match(i.text, /move|raise|clear/i);
  assert.match(i.text, new RegExp(String(CAPTION_ZONE_TOP_Y)));
});

test("overlay fully above the caption zone does NOT intrude", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "cap-clear-"));
  try {
    const mov = join(dir, "clear.mov");
    makeAlphaBox(mov, 0, 300, 1); // opaque box only in the top band
    assert.equal(await overlayIntrudesCaptionBand(mov), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("overlay with SEMI-TRANSPARENT pixels in the caption zone DOES intrude (every-frame scan)", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "cap-hit-"));
  try {
    const mov = join(dir, "hit.mov");
    makeAlphaBox(mov, CAPTION_ZONE_TOP_Y + 20, 160, 0.45); // ~45% alpha across the zone
    assert.equal(await overlayIntrudesCaptionBand(mov), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the check is read-only — it never mutates the MOV", { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "cap-immut-"));
  try {
    const mov = join(dir, "m.mov");
    makeAlphaBox(mov, CAPTION_ZONE_TOP_Y + 20, 160, 0.9);
    const before = await stat(mov);
    const copy = join(dir, "m.copy.mov");
    await copyFile(mov, copy);
    await overlayIntrudesCaptionBand(mov);
    const after = await stat(mov);
    assert.equal(after.size, before.size, "size changed — the probe mutated the MOV");
    // byte-identical to the pre-probe copy
    const cmp = spawnSync("cmp", ["-s", mov, copy]);
    if (cmp.status !== null) assert.equal(cmp.status, 0, "bytes changed — the probe mutated the MOV");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
