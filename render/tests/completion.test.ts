import { test } from "node:test";
import assert from "node:assert/strict";

import { markJobDone } from "../src/completion.js";

test("markJobDone logs DONE only after durable completion succeeds", async () => {
  const events: string[] = [];
  await markJobDone("video-123", "https://storage.example/video.mp4", {
    updateDurable: async () => {
      events.push("persisted");
    },
    log: (message) => events.push(message),
  });

  assert.deepEqual(events, ["persisted", "DONE video-123"]);
});

test("markJobDone does not log DONE when durable completion fails", async () => {
  const messages: string[] = [];
  await assert.rejects(
    markJobDone("video-456", "https://storage.example/video.mp4", {
      updateDurable: async () => {
        throw new Error("database unavailable");
      },
      log: (message) => messages.push(message),
    }),
    /database unavailable/,
  );

  assert.deepEqual(messages, []);
});
