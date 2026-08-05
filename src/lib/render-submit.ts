/**
 * Whether a render POST should start a new job or hand back the one already running.
 *
 * Credits are reserved at submit time, so a duplicate POST is a duplicate charge. The
 * browser retries, users open a second tab, and a lost response is indistinguishable
 * from a failure. Only terminal jobs allow a fresh start; a retry after a real failure
 * is intentional and must still work.
 */
export interface ActiveJob {
  id: string;
  status: string;
}

export type Submission = { action: "start" } | { action: "reuse"; jobId: string };

/** Verified against the schema: queued is the DB default, processing is set by the worker. */
const IN_FLIGHT = new Set(["queued", "processing"]);

export function decideSubmission(active: ActiveJob | null): Submission {
  if (active && IN_FLIGHT.has(active.status)) {
    return { action: "reuse", jobId: active.id };
  }
  return { action: "start" };
}
