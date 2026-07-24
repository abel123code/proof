import { test } from "node:test";
import assert from "node:assert/strict";

import { claimDurableCandidate } from "../src/durable.js";

test("a queued durable job can be claimed by only one worker", async () => {
  let available = true;
  const compareAndSet = async () => {
    if (!available) return false;
    available = false;
    return true;
  };
  const candidate = { id: "job-123", status: "queued", lockedAt: null } as const;

  const [first, second] = await Promise.all([
    claimDurableCandidate(candidate, compareAndSet),
    claimDurableCandidate(candidate, compareAndSet),
  ]);

  assert.equal([first, second].filter(Boolean).length, 1);
});

test("a fresh processing lease is not recoverable", async () => {
  let compareCalls = 0;
  const claimed = await claimDurableCandidate(
    {
      id: "job-456",
      status: "processing",
      lockedAt: new Date().toISOString(),
    },
    async () => {
      compareCalls += 1;
      return true;
    },
  );

  assert.equal(claimed, false);
  assert.equal(compareCalls, 0);
});
