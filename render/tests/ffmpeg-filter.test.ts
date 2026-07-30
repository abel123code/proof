import { test } from "node:test";
import assert from "node:assert/strict";

import { SPEAKER_SAFE_ALPHA_FILTER } from "../src/ffmpeg.js";

test("the speaker-safe alpha filter never routes through 8-bit rgba (segfaults ffmpeg on 12-bit input)", () => {
  // HyperFrames emits ProRes 4444 yuva444p12le. `format=rgba` in this chain crashes ffmpeg 5.1
  // (SIGSEGV / exit 139), which silently killed every overlay-mode scene in production.
  assert.ok(
    !SPEAKER_SAFE_ALPHA_FILTER.includes("rgba"),
    "must not convert to rgba — it segfaults ffmpeg and drops alpha to 8-bit",
  );
  // It must still clear the burned-in caption band, and do it in an alpha-capable format.
  assert.match(SPEAKER_SAFE_ALPHA_FILTER, /^format=yuva444p10le,/);
  assert.match(SPEAKER_SAFE_ALPHA_FILTER, /drawbox=x=0:y=1450:w=iw:h=470/);
  assert.match(SPEAKER_SAFE_ALPHA_FILTER, /replace=1/);
});
