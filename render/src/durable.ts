import type { JobStatus, RenderJobInput } from "./types.js";
import { getSupabaseAdmin } from "./supabase.js";

const PROGRESS: Record<JobStatus, number> = {
  queued: 0,
  transcribing: 12,
  cutting: 30,
  planning: 45,
  rendering: 58,
  "quality-checking": 85,
  uploading: 92,
  done: 100,
  error: 100,
};

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
    ...(phase === "transcribing" ? { started_at: now, locked_at: now } : {}),
    ...(terminal ? { finished_at: now, locked_at: null } : {}),
  };
  if (extra.outputUrl !== undefined) row.output_url = extra.outputUrl;
  if (extra.error !== undefined) row.error = extra.error;

  const { error } = await getSupabaseAdmin().from("render_jobs").update(row).eq("id", id);
  if (error) throw new Error(`updateDurableJob failed: ${error.message}`);
}

export async function loadRecoverableJobs(excludeIds: ReadonlySet<string> = new Set()): Promise<RenderJobInput[]> {
  const supabase = getSupabaseAdmin();
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
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
    const stale = row.status === "queued" || !row.locked_at || row.locked_at < staleBefore;
    if (!stale || Number(row.attempts ?? 0) >= 3) continue;
    const input = row.input as RenderJobInput;
    jobs.push({ ...input, jobId: row.id as string, briefId: row.brief_id as string });
    await supabase
      .from("render_jobs")
      .update({
        status: "queued",
        phase: "queued",
        attempts: Number(row.attempts ?? 0) + 1,
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }
  return jobs;
}
