import type { JobStatus, RenderJobInput } from "./types.js";
import { getSupabaseAdmin } from "./supabase.js";

const PROGRESS: Record<JobStatus, number> = {
  queued: 0,
  transcribing: 12,
  cutting: 30,
  planning: 45,
  rendering: 58,
  scoring: 80,
  "quality-checking": 85,
  uploading: 92,
  done: 100,
  error: 100,
};

const LEASE_MS = 15 * 60_000;

export interface DurableCandidate {
  id: string;
  status: "queued" | "processing";
  lockedAt: string | null;
  attempts?: number;
}

type CompareAndSetLease = (candidate: DurableCandidate, now: string) => Promise<boolean>;

async function compareAndSetLease(candidate: DurableCandidate, now: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("render_jobs")
    .update({
      status: "processing",
      phase: "queued",
      progress: 0,
      output_url: null,
      error: null,
      finished_at: null,
      attempts: Number(candidate.attempts ?? 0) + 1,
      locked_at: now,
      updated_at: now,
    })
    .eq("id", candidate.id)
    .eq("status", candidate.status);
  query = candidate.lockedAt === null
    ? query.is("locked_at", null)
    : query.eq("locked_at", candidate.lockedAt);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`claimDurableCandidate failed: ${error.message}`);
  return (data?.length ?? 0) === 1;
}

/** Atomically reclaim a queued or stale processing job. Fresh leases are never touched. */
export async function claimDurableCandidate(
  candidate: DurableCandidate,
  compareAndSet: CompareAndSetLease = compareAndSetLease,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (
    candidate.status === "processing" &&
    candidate.lockedAt &&
    Date.parse(candidate.lockedAt) >= nowMs - LEASE_MS
  ) {
    return false;
  }
  return compareAndSet(candidate, new Date(nowMs).toISOString());
}

export async function updateDurableJob(
  id: string,
  phase: JobStatus,
  extra: { outputUrl?: string; error?: string } = {},
): Promise<void> {
  const now = new Date().toISOString();
  const terminal = phase === "done" || phase === "error";
  const row: Record<string, unknown> = {
    status: terminal ? phase : phase === "queued" ? "queued" : "processing",
    phase,
    progress: PROGRESS[phase],
    updated_at: now,
    ...(!terminal ? { locked_at: now } : {}),
    ...(phase === "transcribing" ? { started_at: now } : {}),
    ...(terminal ? { finished_at: now, locked_at: null } : {}),
    ...(phase === "queued" ? { output_url: null, error: null, finished_at: null } : {}),
  };
  if (extra.outputUrl !== undefined) row.output_url = extra.outputUrl;
  if (extra.error !== undefined) row.error = extra.error;

  const { error } = await getSupabaseAdmin().from("render_jobs").update(row).eq("id", id);
  if (error) throw new Error(`updateDurableJob failed: ${error.message}`);
}

export async function heartbeatDurableJob(id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("render_jobs")
    .update({ locked_at: now, updated_at: now })
    .eq("id", id)
    .eq("status", "processing");
  if (error) throw new Error(`heartbeatDurableJob failed: ${error.message}`);
}

export async function loadRecoverableJobs(excludeIds: ReadonlySet<string> = new Set()): Promise<RenderJobInput[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("render_jobs")
    .select("id, brief_id, status, locked_at, input, attempts")
    .in("status", ["queued", "processing"])
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(`loadRecoverableJobs failed: ${error.message}`);

  const jobs: RenderJobInput[] = [];
  for (const row of data ?? []) {
    if (excludeIds.has(row.id as string)) continue;
    if (Number(row.attempts ?? 0) >= 3) continue;
    const claimed = await claimDurableCandidate({
      id: row.id as string,
      status: row.status as "queued" | "processing",
      lockedAt: (row.locked_at as string | null) ?? null,
      attempts: Number(row.attempts ?? 0),
    });
    if (!claimed) continue;
    const input = row.input as RenderJobInput;
    jobs.push({ ...input, jobId: row.id as string, briefId: row.brief_id as string });
  }
  return jobs;
}
