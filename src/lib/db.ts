import { getSupabaseAdmin } from "@/lib/supabase";
import { STARTING_CREDITS } from "@/lib/pricing";
import { resolveResumeStage, type ProjectProgress } from "@/lib/resume";
import type {
  Brief,
  BriefDoc,
  ContentBrief,
  InfoGap,
  Project,
  ProjectUnderstanding,
  ReferencePattern,
  ResearchOutput,
  TrendTopic,
} from "@/lib/types";

// When auth is disabled (local dev), the gate hands us this placeholder id.
// It doesn't exist in auth.users, so we must NOT write it to FK columns.
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000000";

/** Null out the dev placeholder so FK columns / filters behave in local dev. */
function realUserId(userId?: string | null): string | null {
  return userId && userId !== DEV_USER_ID ? userId : null;
}

// ---- row shapes (snake_case as stored) ----
interface ProjectRow {
  id: string;
  user_id: string | null;
  repo_url: string;
  name: string;
  understanding: ProjectUnderstanding | null;
  // `trend_research` is repurposed in v2 to store the ResearchOutput blob.
  trend_research: ResearchOutput | null;
  trend_research_updated_at: string | null;
  created_at: string;
}

interface BriefRow {
  id: string;
  user_id: string | null;
  project_id: string;
  reference_video_id: string | null;
  content: ContentBrief | null;
  doc: BriefDoc | null;
  gaps: InfoGap[] | null;
  answers: Record<string, string> | null;
  render_job_id: string | null;
  render_status: string | null;
  render_url: string | null;
  created_at: string;
}

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id,
    repoUrl: r.repo_url,
    name: r.name,
    understanding: r.understanding,
    research: r.trend_research ?? null,
    researchUpdatedAt: r.trend_research_updated_at ?? null,
    createdAt: r.created_at,
  };
}

function mapBrief(r: BriefRow): Brief {
  return {
    id: r.id,
    projectId: r.project_id,
    referenceVideoId: r.reference_video_id,
    content: r.content,
    doc: r.doc ?? null,
    gaps: r.gaps ?? null,
    answers: r.answers ?? null,
    renderJobId: r.render_job_id ?? null,
    renderStatus: r.render_status ?? null,
    renderUrl: r.render_url ?? null,
    createdAt: r.created_at,
  };
}

// ---- projects ----

export async function createProject(input: {
  repoUrl: string;
  name: string;
  understanding?: ProjectUnderstanding | null;
  userId?: string | null;
}): Promise<Project> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      repo_url: input.repoUrl,
      name: input.name,
      understanding: input.understanding ?? null,
      user_id: realUserId(input.userId),
    })
    .select()
    .single();
  if (error) throw new Error(`createProject failed: ${error.message}`);
  return mapProject(data as ProjectRow);
}

export async function listProjects(userId?: string | null): Promise<Project[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase.from("projects").select().order("created_at", { ascending: false });
  const uid = realUserId(userId);
  if (uid) query = query.eq("user_id", uid);
  const { data, error } = await query;
  if (error) throw new Error(`listProjects failed: ${error.message}`);
  return (data as ProjectRow[]).map(mapProject);
}

/**
 * Projects for a user, each annotated with which studio stage to resume into.
 * One extra briefs query (batched over all project ids) keeps this at 2 round-trips
 * regardless of project count. Ordered by most recent activity first.
 */
export async function listProjectsWithProgress(
  userId?: string | null,
): Promise<ProjectProgress[]> {
  const projects = await listProjects(userId);
  if (projects.length === 0) return [];

  const supabase = getSupabaseAdmin();
  const ids = projects.map((p) => p.id);
  const { data, error } = await supabase
    .from("briefs")
    .select("project_id, doc, render_url, render_status, created_at")
    .in("project_id", ids)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listProjectsWithProgress failed: ${error.message}`);

  // First row per project_id is the latest (query is sorted desc).
  const latestByProject = new Map<
    string,
    { doc: unknown | null; renderUrl: string | null; renderStatus: string | null; createdAt: string }
  >();
  for (const row of (data ?? []) as Array<{
    project_id: string;
    doc: unknown | null;
    render_url: string | null;
    render_status: string | null;
    created_at: string;
  }>) {
    if (latestByProject.has(row.project_id)) continue;
    latestByProject.set(row.project_id, {
      doc: row.doc ?? null,
      renderUrl: row.render_url ?? null,
      renderStatus: row.render_status ?? null,
      createdAt: row.created_at,
    });
  }

  return projects
    .map((p) => resolveResumeStage(p, latestByProject.get(p.id) ?? null))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

/**
 * Find the most recent project for a given repo owned by this user (dev user ->
 * null owner). Lets us reuse an already-analyzed repo instead of re-running the
 * understanding model and creating duplicates.
 */
export async function getProjectByRepo(
  userId: string | null | undefined,
  repoUrl: string,
): Promise<Project | null> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("projects")
    .select()
    .eq("repo_url", repoUrl)
    .order("created_at", { ascending: false })
    .limit(1);
  const uid = realUserId(userId);
  query = uid ? query.eq("user_id", uid) : query.is("user_id", null);
  const { data, error } = await query;
  if (error) throw new Error(`getProjectByRepo failed: ${error.message}`);
  const row = (data as ProjectRow[])[0];
  return row ? mapProject(row) : null;
}

export async function getProject(id: string): Promise<Project | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("projects")
    .select()
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getProject failed: ${error.message}`);
  return data ? mapProject(data as ProjectRow) : null;
}

/** Persist the latest research output (proof + topics) onto a project. */
export async function saveResearch(
  projectId: string,
  research: ResearchOutput,
): Promise<Project> {
  const supabase = getSupabaseAdmin();
  const updatedAt = research.updatedAt ?? new Date().toISOString();
  const { data, error } = await supabase
    .from("projects")
    .update({
      trend_research: { ...research, updatedAt },
      trend_research_updated_at: updatedAt,
    })
    .eq("id", projectId)
    .select()
    .single();
  if (error) throw new Error(`saveResearch failed: ${error.message}`);
  return mapProject(data as ProjectRow);
}

// ---- research cache (shared, keyed) ----
// One generic table keyed by a string. Trends are cached globally for a day
// ("trends:<YYYY-MM-DD>"); reference patterns are cached per topic ("refs:<topic>").

async function getCache<T>(key: string, maxAgeMs?: number): Promise<T | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("trend_cache")
    .select("payload, created_at")
    .eq("cache_key", key)
    .maybeSingle();
  if (error) throw new Error(`getCache failed: ${error.message}`);
  if (!data) return null;
  if (maxAgeMs) {
    const age = Date.now() - new Date((data as { created_at: string }).created_at).getTime();
    if (age > maxAgeMs) return null;
  }
  return (data as { payload: T }).payload;
}

async function setCache<T>(key: string, payload: T): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("trend_cache")
    .upsert(
      { cache_key: key, payload, created_at: new Date().toISOString() },
      { onConflict: "cache_key" },
    );
  if (error) throw new Error(`setCache failed: ${error.message}`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getCachedTrends(): Promise<TrendTopic[] | null> {
  const key = `trends:${new Date().toISOString().slice(0, 10)}`;
  return getCache<TrendTopic[]>(key, DAY_MS);
}

export async function setCachedTrends(topics: TrendTopic[]): Promise<void> {
  const key = `trends:${new Date().toISOString().slice(0, 10)}`;
  await setCache(key, topics);
}

export async function getCachedReferences(topic: string): Promise<ReferencePattern[] | null> {
  return getCache<ReferencePattern[]>(`refs:${topic.toLowerCase().trim()}`, 7 * DAY_MS);
}

export async function setCachedReferences(
  topic: string,
  refs: ReferencePattern[],
): Promise<void> {
  await setCache(`refs:${topic.toLowerCase().trim()}`, refs);
}

// ---- profiles + allowlist (gated onboarding) ----

export interface Profile {
  userId: string;
  email: string | null;
  githubUsername: string | null;
  isAdmin: boolean;
  createdAt: string;
}

interface ProfileRow {
  user_id: string;
  email: string | null;
  github_username: string | null;
  is_admin?: boolean;
  created_at: string;
}

function mapProfile(r: ProfileRow): Profile {
  return {
    userId: r.user_id,
    email: r.email,
    githubUsername: r.github_username,
    isAdmin: Boolean(r.is_admin),
    createdAt: r.created_at,
  };
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .select()
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`getProfile failed: ${error.message}`);
  if (!data) return null;
  return mapProfile(data as ProfileRow);
}

/** Update the saved GitHub handle on a user's profile. Dev user is a no-op. */
export async function updateProfileGithub(
  userId: string,
  githubUsername: string,
): Promise<void> {
  if (!realUserId(userId)) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("profiles")
    .update({ github_username: githubUsername })
    .eq("user_id", userId);
  if (error) throw new Error(`updateProfileGithub failed: ${error.message}`);
}

export async function countProfiles(): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`countProfiles failed: ${error.message}`);
  return count ?? 0;
}

/** Is this identity on the approved allowlist? Matched by email OR github handle. */
export async function isAllowlisted(
  email: string | null,
  githubUsername: string | null,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const ors: string[] = [];
  if (email) ors.push(`email.eq.${email}`);
  if (githubUsername) ors.push(`github_username.eq.${githubUsername}`);
  if (ors.length === 0) return false;
  const { data, error } = await supabase
    .from("allowed_users")
    .select("id")
    .or(ors.join(","))
    .limit(1);
  if (error) throw new Error(`isAllowlisted failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

const USER_CAP = 50;

/**
 * Ensure an approved profile exists for a freshly-signed-in user. Returns a
 * status the callback can use to route the user. Enforces the 50-user cap.
 */
export async function ensureProfile(input: {
  userId: string;
  email: string | null;
  githubUsername: string | null;
}): Promise<"active" | "pending" | "full"> {
  const existing = await getProfile(input.userId);
  if (existing) return "active";

  const allowed = await isAllowlisted(input.email, input.githubUsername);
  if (!allowed) {
    // Log the attempt so an admin can approve/reject it from the /admin page.
    // Best-effort, but surface failures so a broken insert isn't silent.
    await recordAccessRequest(input.email, input.githubUsername).catch((e) => {
      console.error("recordAccessRequest failed:", e);
    });
    return "pending";
  }

  const count = await countProfiles();
  if (count >= USER_CAP) return "full";

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("profiles").insert({
    user_id: input.userId,
    email: input.email,
    github_username: input.githubUsername,
  });
  if (error) throw new Error(`ensureProfile failed: ${error.message}`);
  return "active";
}

// ---- admin: user management ----

export interface AllowedUser {
  id: string;
  email: string | null;
  githubUsername: string | null;
  note: string | null;
  createdAt: string;
}

export interface AccessRequest {
  id: string;
  email: string | null;
  githubUsername: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

/** True if this user is an admin. Dev (null) user is treated as admin locally. */
export async function isAdminUser(userId: string): Promise<boolean> {
  if (!realUserId(userId)) return true;
  const profile = await getProfile(userId);
  return Boolean(profile?.isAdmin);
}

/** Record a sign-in attempt from someone not yet allowlisted (idempotent per email). */
export async function recordAccessRequest(
  email: string | null,
  githubUsername: string | null,
): Promise<void> {
  if (!email && !githubUsername) return;
  const supabase = getSupabaseAdmin();
  // The unique index on email is PARTIAL (where email is not null), which Postgres
  // cannot use for ON CONFLICT - so an upsert throws. Check-then-insert instead.
  if (email) {
    const { data: existing } = await supabase
      .from("access_requests")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing) return;
  }
  const { error } = await supabase
    .from("access_requests")
    .insert({ email, github_username: githubUsername, status: "pending" });
  if (error) throw new Error(`recordAccessRequest failed: ${error.message}`);
}

export async function listAllProfiles(): Promise<Profile[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .select()
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listAllProfiles failed: ${error.message}`);
  return (data as ProfileRow[]).map(mapProfile);
}

export async function listAllowedUsers(): Promise<AllowedUser[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("allowed_users")
    .select()
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listAllowedUsers failed: ${error.message}`);
  return (data as Array<{
    id: string;
    email: string | null;
    github_username: string | null;
    note: string | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    email: r.email,
    githubUsername: r.github_username,
    note: r.note,
    createdAt: r.created_at,
  }));
}

export async function listAccessRequests(): Promise<AccessRequest[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("access_requests")
    .select()
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listAccessRequests failed: ${error.message}`);
  return (data as Array<{
    id: string;
    email: string | null;
    github_username: string | null;
    status: AccessRequest["status"];
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    email: r.email,
    githubUsername: r.github_username,
    status: r.status,
    createdAt: r.created_at,
  }));
}

/** Add an email (and optional handle/note) to the approved allowlist. */
export async function addAllowedUser(input: {
  email?: string | null;
  githubUsername?: string | null;
  note?: string | null;
}): Promise<void> {
  const email = input.email?.trim().toLowerCase() || null;
  const githubUsername = input.githubUsername?.trim() || null;
  if (!email && !githubUsername) throw new Error("email or githubUsername required");
  const supabase = getSupabaseAdmin();
  // Partial unique index on email can't back ON CONFLICT, so check-then-insert.
  if (email) {
    const { data: existing } = await supabase
      .from("allowed_users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existing) return;
  }
  const { error } = await supabase
    .from("allowed_users")
    .insert({ email, github_username: githubUsername, note: input.note ?? null });
  if (error) throw new Error(`addAllowedUser failed: ${error.message}`);
}

export async function removeAllowedUser(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("allowed_users").delete().eq("id", id);
  if (error) throw new Error(`removeAllowedUser failed: ${error.message}`);
}

/** Approve a pending request: allowlist its email and mark it approved. */
export async function approveAccessRequest(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("access_requests")
    .select()
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`approveAccessRequest failed: ${error.message}`);
  if (!data) throw new Error("Request not found");
  const req = data as { email: string | null; github_username: string | null };
  await addAllowedUser({ email: req.email, githubUsername: req.github_username });
  const { error: updErr } = await supabase
    .from("access_requests")
    .update({ status: "approved" })
    .eq("id", id);
  if (updErr) throw new Error(`approveAccessRequest failed: ${updErr.message}`);
}

export async function rejectAccessRequest(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("access_requests")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) throw new Error(`rejectAccessRequest failed: ${error.message}`);
}

// ---- credit wallet ----
// One lifetime balance per user. Every paid action reserves credits up front
// (atomic, burst-safe) and refunds on failure. See src/lib/pricing.ts.

export interface Usage {
  userId: string;
  creditsTotal: number;
  creditsUsed: number;
}

interface UsageRow {
  user_id: string;
  credits_total: number;
  credits_used: number;
}

function mapUsage(r: UsageRow): Usage {
  return {
    userId: r.user_id,
    creditsTotal: r.credits_total,
    creditsUsed: r.credits_used,
  };
}

async function getOrCreateUsage(userId: string): Promise<Usage> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("usage")
    .select("user_id, credits_total, credits_used")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`getUsage failed: ${error.message}`);
  if (data) return mapUsage(data as UsageRow);
  // Seed the balance from the (env-configurable) starting grant.
  const { data: created, error: insErr } = await supabase
    .from("usage")
    .insert({ user_id: userId, credits_total: STARTING_CREDITS })
    .select("user_id, credits_total, credits_used")
    .single();
  if (insErr) throw new Error(`create usage failed: ${insErr.message}`);
  return mapUsage(created as UsageRow);
}

export interface Wallet {
  total: number;
  used: number;
  remaining: number;
}

/** Current balance. Dev / unauthenticated users are treated as unlimited. */
export async function getWallet(userId: string): Promise<Wallet> {
  if (!realUserId(userId)) {
    return { total: STARTING_CREDITS, used: 0, remaining: STARTING_CREDITS };
  }
  const usage = await getOrCreateUsage(userId);
  return {
    total: usage.creditsTotal,
    used: usage.creditsUsed,
    remaining: Math.max(0, usage.creditsTotal - usage.creditsUsed),
  };
}

/** Non-mutating check used for friendly pre-flight errors. */
export async function hasCredits(userId: string, amount: number): Promise<boolean> {
  if (!realUserId(userId)) return true;
  const wallet = await getWallet(userId);
  return wallet.remaining >= amount;
}

/**
 * Atomically reserve `amount` credits. Returns ok:false (without charging) when
 * the balance is insufficient. Charge BEFORE doing the paid work, then refund
 * on failure - this is burst-safe (parallel requests can't all pass a check and
 * then run for free).
 */
export async function spendCredits(
  userId: string,
  amount: number,
): Promise<{ ok: boolean; remaining: number }> {
  if (!realUserId(userId)) return { ok: true, remaining: STARTING_CREDITS };
  if (amount <= 0) {
    const wallet = await getWallet(userId);
    return { ok: true, remaining: wallet.remaining };
  }
  // The RPC only deducts within-balance, but it no-ops on a missing row, so
  // guarantee the row exists first (else a new user reads as "insufficient").
  await getOrCreateUsage(userId);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("spend_credits", {
    p_user: userId,
    p_amt: amount,
  });
  if (error) throw new Error(`spendCredits failed: ${error.message}`);
  if (data === null || data === undefined) return { ok: false, remaining: 0 };
  return { ok: true, remaining: Number(data) };
}

/** Give back reserved credits when the downstream work fails. Best-effort. */
export async function refundCredits(userId: string, amount: number): Promise<void> {
  if (!realUserId(userId) || amount <= 0) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc("refund_credits", {
    p_user: userId,
    p_amt: amount,
  });
  if (error) throw new Error(`refundCredits failed: ${error.message}`);
}

/** All wallets keyed by userId (read-only; does not create rows). For admin. */
export async function listWallets(): Promise<Record<string, Wallet>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("usage")
    .select("user_id, credits_total, credits_used");
  if (error) throw new Error(`listWallets failed: ${error.message}`);
  const map: Record<string, Wallet> = {};
  for (const r of (data ?? []) as UsageRow[]) {
    map[r.user_id] = {
      total: r.credits_total,
      used: r.credits_used,
      remaining: Math.max(0, r.credits_total - r.credits_used),
    };
  }
  return map;
}

/** Admin top-up: raise the user's total balance by `amount`. */
export async function grantCredits(userId: string, amount: number): Promise<void> {
  if (!realUserId(userId) || amount === 0) return;
  const usage = await getOrCreateUsage(userId);
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("usage")
    .update({ credits_total: usage.creditsTotal + amount })
    .eq("user_id", userId);
  if (error) throw new Error(`grantCredits failed: ${error.message}`);
}

// ---- scene footage ----
const FOOTAGE_BUCKET = "footage";

/** All footage for a brief, mapped sceneIndex -> public URL. */
export async function listSceneFootage(briefId: string): Promise<Record<number, string>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("scene_footage")
    .select("scene_index, url")
    .eq("brief_id", briefId);
  if (error) throw new Error(`listSceneFootage failed: ${error.message}`);
  const map: Record<number, string> = {};
  for (const row of (data ?? []) as { scene_index: number; url: string }[]) {
    map[row.scene_index] = row.url;
  }
  return map;
}

/** Upload a scene clip to storage and upsert its footage row. Returns the URL. */
export async function uploadSceneFootage(input: {
  briefId: string;
  sceneIndex: number;
  bytes: ArrayBuffer | Uint8Array | Buffer;
  contentType: string;
}): Promise<string> {
  const supabase = getSupabaseAdmin();
  const ext = input.contentType.includes("mp4") ? "mp4" : "webm";
  const path = `${input.briefId}/scene-${input.sceneIndex}.${ext}`;

  const body =
    input.bytes instanceof Uint8Array || Buffer.isBuffer(input.bytes)
      ? input.bytes
      : new Uint8Array(input.bytes);

  const { error: upErr } = await supabase.storage
    .from(FOOTAGE_BUCKET)
    .upload(path, body, { contentType: input.contentType, upsert: true });
  if (upErr) throw new Error(`footage upload failed: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(FOOTAGE_BUCKET).getPublicUrl(path);
  // Cache-bust so a re-record of the same scene shows the new take.
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: rowErr } = await supabase
    .from("scene_footage")
    .upsert(
      {
        brief_id: input.briefId,
        scene_index: input.sceneIndex,
        url,
        storage_path: path,
      },
      { onConflict: "brief_id,scene_index" },
    );
  if (rowErr) throw new Error(`footage row upsert failed: ${rowErr.message}`);

  return url;
}

function footagePath(briefId: string, sceneIndex: number, contentType: string): string {
  const ext = contentType.includes("mp4") ? "mp4" : "webm";
  return `${briefId}/scene-${sceneIndex}.${ext}`;
}

/**
 * Mint a short-lived signed upload URL so the browser can PUT the clip straight to
 * Supabase Storage, bypassing the Vercel serverless request-body limit (~4.5MB, which
 * capped clips at ~30s). The bytes never transit our server. Pair with recordSceneFootage.
 */
export async function createFootageUploadTicket(input: {
  briefId: string;
  sceneIndex: number;
  contentType: string;
}): Promise<{ path: string; token: string; signedUrl: string }> {
  const supabase = getSupabaseAdmin();
  const path = footagePath(input.briefId, input.sceneIndex, input.contentType);
  const { data, error } = await supabase.storage
    .from(FOOTAGE_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error) throw new Error(`footage sign failed: ${error.message}`);
  return { path, token: data.token, signedUrl: data.signedUrl };
}

/** Record a scene_footage row after a direct (signed) upload has landed. Returns the URL. */
export async function recordSceneFootage(input: {
  briefId: string;
  sceneIndex: number;
  storagePath: string;
  userId: string;
}): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data: pub } = supabase.storage.from(FOOTAGE_BUCKET).getPublicUrl(input.storagePath);
  // Cache-bust so a re-record of the same scene shows the new take.
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: rowErr } = await supabase
    .from("scene_footage")
    .upsert(
      {
        brief_id: input.briefId,
        scene_index: input.sceneIndex,
        url,
        storage_path: input.storagePath,
        user_id: input.userId === DEV_USER_ID ? null : input.userId,
      },
      { onConflict: "brief_id,scene_index" },
    );
  if (rowErr) throw new Error(`footage row upsert failed: ${rowErr.message}`);

  return url;
}

/** Delete a scene's footage (storage object + row). */
export async function deleteSceneFootage(briefId: string, sceneIndex: number): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("scene_footage")
    .select("storage_path")
    .eq("brief_id", briefId)
    .eq("scene_index", sceneIndex)
    .maybeSingle();
  if (error) throw new Error(`deleteSceneFootage lookup failed: ${error.message}`);
  const path = (data as { storage_path: string | null } | null)?.storage_path;
  if (path) {
    await supabase.storage.from(FOOTAGE_BUCKET).remove([path]);
  }
  const { error: delErr } = await supabase
    .from("scene_footage")
    .delete()
    .eq("brief_id", briefId)
    .eq("scene_index", sceneIndex);
  if (delErr) throw new Error(`deleteSceneFootage failed: ${delErr.message}`);
}

// ---- briefs ----

/** Persist a scene-by-scene content brief (with the gap Q&A that produced it). */
export async function saveBriefDoc(input: {
  projectId: string;
  doc: BriefDoc;
  gaps: InfoGap[];
  answers: Record<string, string>;
  userId?: string | null;
}): Promise<Brief> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("briefs")
    .insert({
      project_id: input.projectId,
      reference_video_id: null,
      doc: input.doc,
      gaps: input.gaps,
      answers: input.answers,
      user_id: realUserId(input.userId),
    })
    .select()
    .single();
  if (error) throw new Error(`saveBriefDoc failed: ${error.message}`);
  return mapBrief(data as BriefRow);
}

/** Most recent saved brief (with a doc) for a project, if any. */
export async function getLatestBriefForProject(projectId: string): Promise<Brief | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("briefs")
    .select()
    .eq("project_id", projectId)
    .not("doc", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestBriefForProject failed: ${error.message}`);
  return data ? mapBrief(data as BriefRow) : null;
}

/** Fetch a single brief by id. */
export async function getBriefById(briefId: string): Promise<Brief | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("briefs")
    .select("*")
    .eq("id", briefId)
    .maybeSingle();
  if (error) throw new Error(`getBriefById failed: ${error.message}`);
  return data ? mapBrief(data as BriefRow) : null;
}

/**
 * Ownership guard for service-role routes. The API routes use the service-role client,
 * which BYPASSES row-level security, so a briefId alone is not enough — we must confirm
 * the caller owns the brief or any approved user could touch anyone's footage/renders.
 * Dev (auth off, DEV_USER_ID) is a single identity and always passes.
 */
export async function assertBriefOwnedBy(briefId: string, userId: string): Promise<boolean> {
  if (userId === DEV_USER_ID) return true;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("briefs")
    .select("user_id")
    .eq("id", briefId)
    .maybeSingle();
  if (error) throw new Error(`ownership check failed: ${error.message}`);
  if (!data) return false;
  return (data as { user_id: string | null }).user_id === userId;
}

/**
 * Ownership guard for project-scoped service-role routes. Like assertBriefOwnedBy,
 * this exists because the API uses the service-role client (which BYPASSES RLS), so a
 * projectId from the request is not proof of ownership — without this any approved user
 * could read/overwrite another user's project by supplying its id.
 * Dev (auth off, DEV_USER_ID) is a single identity and always passes.
 */
export async function assertProjectOwnedBy(projectId: string, userId: string): Promise<boolean> {
  if (userId === DEV_USER_ID) return true;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("projects")
    .select("user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(`project ownership check failed: ${error.message}`);
  if (!data) return false;
  return (data as { user_id: string | null }).user_id === userId;
}

/** Persist the render state (job id / status / finished MP4 URL) on a brief. */
export async function saveBriefRender(
  briefId: string,
  patch: { jobId?: string; status?: string; url?: string },
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const row: Record<string, unknown> = {};
  if (patch.jobId !== undefined) row.render_job_id = patch.jobId;
  if (patch.status !== undefined) row.render_status = patch.status;
  if (patch.url !== undefined) row.render_url = patch.url;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from("briefs").update(row).eq("id", briefId);
  if (error) throw new Error(`saveBriefRender failed: ${error.message}`);
}

export interface DurableRenderJob {
  id: string;
  status: string;
  phase: string;
  progress: number;
  outputUrl: string | null;
  error: string | null;
}

export async function createRenderJob(args: {
  id: string;
  briefId: string;
  userId: string;
  input: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("render_jobs").insert({
    id: args.id,
    brief_id: args.briefId,
    user_id: args.userId,
    status: "queued",
    phase: "queued",
    progress: 0,
    input: args.input,
  });
  if (error) throw new Error(`createRenderJob failed: ${error.message}`);
}

export async function getRenderJob(args: {
  id: string;
  briefId: string;
  userId: string;
}): Promise<DurableRenderJob | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("render_jobs")
    .select("id, status, phase, progress, output_url, error")
    .eq("id", args.id)
    .eq("brief_id", args.briefId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) throw new Error(`getRenderJob failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as string,
    status: data.status as string,
    phase: data.phase as string,
    progress: Number(data.progress ?? 0),
    outputUrl: (data.output_url as string | null) ?? null,
    error: (data.error as string | null) ?? null,
  };
}

export async function failRenderJob(id: string, errorMessage: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("render_jobs")
    .update({
      status: "error",
      phase: "error",
      error: errorMessage,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`failRenderJob failed: ${error.message}`);
}

/** Wipe the render state on a brief (used when deleting an edited video). */
export async function clearBriefRender(briefId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("briefs")
    .update({ render_job_id: null, render_status: null, render_url: null })
    .eq("id", briefId);
  if (error) throw new Error(`clearBriefRender failed: ${error.message}`);
}
