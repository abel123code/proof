import { test } from "node:test";
import assert from "node:assert/strict";
import { createSemaphore } from "../src/semaphore.js";

/** A promise you resolve by hand, to control when a task "finishes". */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test("runs up to `limit` tasks concurrently and queues the rest", async () => {
  const sem = createSemaphore(2);
  const gates = [deferred(), deferred(), deferred(), deferred()];
  const runs = gates.map((g) => sem.run(() => g.promise));

  await new Promise((r) => setTimeout(r, 0)); // let acquisitions settle
  assert.equal(sem.active, 2, "only `limit` run at once");
  assert.equal(sem.queued, 2, "the rest wait");

  gates[0].resolve(); // free one slot
  await runs[0];
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sem.active, 2, "a queued task took the freed slot");
  assert.equal(sem.queued, 1);

  gates[1].resolve(); gates[2].resolve(); gates[3].resolve();
  await Promise.all(runs);
  assert.equal(sem.active, 0);
  assert.equal(sem.queued, 0);
});

test("releases the slot even when a task throws", async () => {
  const sem = createSemaphore(1);
  await assert.rejects(sem.run(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(sem.active, 0, "a failed task must not leak its slot");
  // The next task must still be able to run.
  const ran = await sem.run(async () => "ok");
  assert.equal(ran, "ok");
});

test("starts queued tasks in FIFO order", async () => {
  const sem = createSemaphore(1);
  const order: number[] = [];
  const g = deferred();
  const first = sem.run(async () => { await g.promise; order.push(1); });
  const second = sem.run(async () => { order.push(2); });
  const third = sem.run(async () => { order.push(3); });
  g.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(order, [1, 2, 3]);
});
