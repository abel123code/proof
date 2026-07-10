/**
 * A tiny async semaphore. `run(fn)` executes `fn` once a slot is free, capping the
 * number of concurrent tasks at `limit`; excess tasks wait FIFO and start as slots free.
 *
 * Why the render service needs this: one Remotion render already saturates the CPU and
 * holds a large ProRes overlay in memory. Load-testing the live Railway box (2026-07-10)
 * showed 2 concurrent renders succeed (and run faster per-job by overlapping one job's
 * whisper/upload I/O with another's compute), but 3 concurrent OOMs the ffmpeg composite
 * ("Failed to inject frame into filter network: Resource temporarily unavailable").
 * See DECISIONS.md 2026-07-10.
 */
export function createSemaphore(limit: number) {
  const max = Math.max(1, Math.floor(limit));
  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < max) {
        active++;
        resolve();
      } else {
        waiters.push(() => {
          active++;
          resolve();
        });
      }
    });

  const release = (): void => {
    active--;
    waiters.shift()?.(); // hand the freed slot to the next waiter, in order
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release(); // always free the slot, even if fn threw
      }
    },
    get active() {
      return active;
    },
    get queued() {
      return waiters.length;
    },
  };
}
