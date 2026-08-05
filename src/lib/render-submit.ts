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
  updatedAt: string | null;
}

export type Submission = { action: "start" } | { action: "reuse"; jobId: string };

/** Verified against the schema: queued is the DB default, processing is set by the worker. */
const IN_FLIGHT = new Set(["queued", "processing"]);

/**
 * The render worker (`render/src/durable.ts`) stops retrying a job after 3 attempts and
 * never writes a terminal status, so a job the worker gave up on sits in `processing`
 * forever. Reusing that row unconditionally would lock the brief out of rendering for
 * good. Deliberately longer than the worker's own LEASE_MS (15 minutes, see durable.ts)
 * so a job that is still validly leased is never mistaken for abandoned.
 */
export const STALE_AFTER_MS = 20 * 60_000;

export function decideSubmission(active: ActiveJob | null, nowMs: number): Submission {
  if (active && IN_FLIGHT.has(active.status)) {
    // A missing or unparseable timestamp cannot be proven fresh. Blocking the user on
    // a row we cannot age would strand them with no way to render at all, so treat it
    // the same as "start" - failing toward letting the user proceed.
    const updatedMs = active.updatedAt ? Date.parse(active.updatedAt) : NaN;
    if (!Number.isNaN(updatedMs) && nowMs - updatedMs < STALE_AFTER_MS) {
      return { action: "reuse", jobId: active.id };
    }
  }
  return { action: "start" };
}
