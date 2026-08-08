import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { STARTING_CREDITS } from "@/lib/pricing";
import type { OnboardingState } from "@/lib/onboarding";
import { resolveResumeStage, type ProjectProgress } from "@/lib/resume";
import { resolveUserCap } from "@/lib/pending";
import { openSignupEnabled } from "@/lib/signup";
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
  assets: { images?: string[]; brandColor?: string } | null;
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
    // Without this a returning user opens a brief with assets attached, sees an empty grid,
    // and re-uploads what is already there.
    assetImages: r.assets?.images ?? [],
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
  onboardingState: OnboardingState;
  onboardingVersion: number;
  onboardingCompletedAt: string | null;
  /** GitHub App installation id, or null when private repos aren't connected. Not a secret. */
  githubInstallationId: number | null;
  createdAt: string;
}

interface ProfileRow {
  user_id: string;
  email: string | null;
  github_username: string | null;
  is_admin?: boolean;
  onboarding_state?: OnboardingState;
  onboarding_version?: number;
  onboarding_completed_at?: string | null;
  github_installation_id?: number | string | null;
  created_at: string;
}

function mapProfile(r: ProfileRow): Profile {
  return {
    userId: r.user_id,
    email: r.email,
    githubUsername: r.github_username,
    isAdmin: Boolean(r.is_admin),
    onboardingState: r.onboarding_state ?? "not_started",
    onboardingVersion: r.onboarding_version ?? 1,
    onboardingCompletedAt: r.onboarding_completed_at ?? null,
    // bigint can arrive as a string from postgrest; normalise to number | null.
    githubInstallationId:
      r.github_installation_id == null ? null : Number(r.github_installation_id),
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

/**
 * Save (or clear, with null) the user's GitHub App installation id.
 *
 * Only the id is stored. It is not a credential, access tokens are minted per request from the app
 * private key and never persisted, so a database leak cannot be replayed against anyone's private
 * repositories. See `src/lib/github-app.ts`.
 */
export async function setProfileGithubInstallation(
  userId: string,
  installationId: number | null,
): Promise<void> {
  if (!realUserId(userId)) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("profiles")
    .update({ github_installation_id: installationId })
    .eq("user_id", userId);
  if (error) throw new Error(`setProfileGithubInstallation failed: ${error.message}`);
}

export async function updateProfileOnboarding(
  userId: string,
  state: OnboardingState,
  version: number,
): Promise<void> {
  if (!realUserId(userId)) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("profiles")
    .update({
      onboarding_state: state,
      onboarding_version: version,
      onboarding_completed_at:
        state === "completed" ? new Date().toISOString() : null,
    })
    .eq("user_id", userId);
  if (error) throw new Error(`updateProfileOnboarding failed: ${error.message}`);
}

export async function countProfiles(): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`countProfiles failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Is this identity on the approved allowlist? Matched on the provider-verified email
 * ONLY, and never on a GitHub handle.
 *
 * This used to build a PostgREST `.or()` filter by string-interpolating both the email
 * and the handle, and the handle came from `user.user_metadata.user_name`. Supabase lets
 * the user write that field themselves (`auth.updateUser({ data: ... })`; `app_metadata`
 * is the protected one). Setting it to `x,id.not.is.null` produced the filter
 * `github_username.eq.x,id.not.is.null`, and the second term is true for every row, so
 * the allowlist matched for anyone with a Google account. Verified against the live
 * database on 2026-08-01: the benign handle returned [], the injected one returned a row.
 *
 * Both halves of that are fixed here, not just the injection. The value is bound as an
 * argument so it cannot escape into the filter, AND the decision is made from the email,
 * which comes from the identity provider and the user cannot alter. Escaping alone would
 * have left plain impersonation open the moment somebody was allowlisted by handle.
 *
 * `allowed_users.github_username` still exists and is still displayed in /admin, but it
 * carries no authorization weight. All 17 live rows were email-bearing when this changed,
 * so nothing lost access; `addAllowedUser` now requires an email to keep it that way.
 */
export async function isAllowlisted(email: string | null): Promise<boolean> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("allowed_users")
    .select("id")
    .eq("email", normalized)
    .limit(1);
  if (error) throw new Error(`isAllowlisted failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

// Env-overridable, like every credit constant already is. A cohort bigger than the
// original 50 should not need a code change, and it is read per call so a Vercel env
// update takes effect on the next request rather than the next cold start.
const userCap = () => resolveUserCap(process.env.USER_CAP);

/**
 * Ensure an approved profile exists for a freshly-signed-in user. Returns a
 * status the caller can use to route the user. Enforces the early-access cap.
 *
 * Idempotent, and /pending depends on that: it re-runs this on every load so a user
 * approved after signing in is let through without having to sign out and back in.
 */
export async function ensureProfile(input: {
  userId: string;
  email: string | null;
  githubUsername: string | null;
}): Promise<"active" | "pending" | "full"> {
  const existing = await getProfile(input.userId);
  if (existing) return "active";

  // Open signup admits anyone who can sign in, so judges do not have to wait to be
  // approved. The USER_CAP check below still runs: without a ceiling, an open door lets a
  // stranger drain the OpenAI budget and the 1GB of Supabase storage.
  //
  // Email only when the allowlist IS in force. `input.githubUsername` originates from
  // user-writable auth metadata and must never influence an authorization decision.
  // See isAllowlisted.
  const allowed = openSignupEnabled() || (await isAllowlisted(input.email));
  if (!allowed) {
    // Log the attempt so an admin can approve/reject it from the /admin page.
    // Best-effort, but surface failures so a broken insert isn't silent.
    await recordAccessRequest(input.email, input.githubUsername).catch((e) => {
      console.error("recordAccessRequest failed:", e);
    });
    return "pending";
  }

  const count = await countProfiles();
  if (count >= userCap()) return "full";

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

/**
 * Add an email (and optional handle/note) to the approved allowlist.
 *
 * An email is REQUIRED. Access is granted by matching the provider-verified email, so a
 * handle-only row would sit in the table looking approved while never letting anyone in.
 * Rejecting it here is louder than that silent trap.
 */
export async function addAllowedUser(input: {
  email?: string | null;
  githubUsername?: string | null;
  note?: string | null;
}): Promise<void> {
  const email = input.email?.trim().toLowerCase() || null;
  const githubUsername = input.githubUsername?.trim() || null;
  if (!email) throw new Error("An email is required to allowlist someone.");
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
  // Approval grants access by email, so a request without one cannot be approved into a
  // working allowlist entry. Fail loudly rather than writing a row that never admits them.
  if (!req.email) {
    throw new Error("This request has no email, so it cannot be approved. Add the email manually.");
  }
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

// ---- bug reports ----
// Beta feedback loop: the studio header lets a user send a message with the
// diagnostic context the client already holds. Admins triage on /admin.

/** Diagnostic context attached to a report. Loose by design — best-effort capture. */
export interface BugReportContext {
  url?: string;
  projectId?: string | null;
  briefId?: string | null;
  renderJobId?: string | null;
  renderStatus?: string | null;
  renderUrl?: string | null;
  /** The render-failure message the app otherwise throws away into a toast. */
  lastError?: string | null;
  userAgent?: string;
}

export interface BugReport {
  id: string;
  email: string | null;
  message: string;
  context: BugReportContext | null;
  status: "open" | "closed";
  createdAt: string;
}

/** Store a bug report. `user_id` goes through realUserId so local dev doesn't hit the FK. */
export async function insertBugReport(input: {
  userId?: string | null;
  email?: string | null;
  message: string;
  context?: BugReportContext | null;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("bug_reports").insert({
    user_id: realUserId(input.userId),
    email: input.email ?? null,
    message: input.message,
    context: input.context ?? null,
    status: "open",
  });
  if (error) throw new Error(`insertBugReport failed: ${error.message}`);
}

export async function listBugReports(): Promise<BugReport[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("bug_reports")
    .select()
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listBugReports failed: ${error.message}`);
  return (
    data as Array<{
      id: string;
      email: string | null;
      message: string;
      context: BugReportContext | null;
      status: string;
      created_at: string;
    }>
  ).map((r) => ({
    id: r.id,
    email: r.email,
    message: r.message,
    context: r.context ?? null,
    status: r.status === "closed" ? "closed" : "open",
    createdAt: r.created_at,
  }));
}

export async function updateBugReportStatus(
  id: string,
  status: "open" | "closed",
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("bug_reports").update({ status }).eq("id", id);
  if (error) throw new Error(`updateBugReportStatus failed: ${error.message}`);
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
  // Only webm stays webm; everything else (mp4, and H.264-in-quicktime clips from phones) is
  // stored as .mp4 so the in-app <video> preview can actually play it.
  const ext = input.contentType.includes("webm") ? "webm" : "mp4";
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
  // Only webm stays webm; quicktime/mov/mp4 all become .mp4 (browser-playable H.264 container).
  const ext = contentType.includes("webm") ? "webm" : "mp4";
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
 * which BYPASSES row-level security, so a briefId alone is not enough, we must confirm
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
 * projectId from the request is not proof of ownership, without this any approved user
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

// ---- brand assets ----
const BRAND_ASSETS_BUCKET = "brand-assets";

/** image/png -> png, image/webp -> webp; everything else (image/jpeg, the only other
 *  content type the route allows) becomes .jpg. */
function assetExt(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

/**
 * Mint a short-lived signed upload URL so the browser can PUT a brand screenshot or
 * logo straight to Supabase Storage, the same pattern (and the same reason - the
 * Vercel serverless body limit) as createFootageUploadTicket. Returns the same
 * { path, token } shape so the client upload code is identical.
 */
export async function createAssetUploadTicket(input: {
  briefId: string;
  contentType: string;
}): Promise<{ path: string; token: string; signedUrl: string }> {
  const supabase = getSupabaseAdmin();
  const path = `${input.briefId}/${randomUUID()}.${assetExt(input.contentType)}`;
  const { data, error } = await supabase.storage
    .from(BRAND_ASSETS_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error) throw new Error(`asset sign failed: ${error.message}`);
  return { path, token: data.token, signedUrl: data.signedUrl };
}

/**
 * Persist a brief's brand assets into the `assets` jsonb column the render worker
 * reads (RenderAssets: images, brandColor, brandVoice, motif). Reads the row first and
 * merges rather than overwriting, because the worker also reads brandVoice/motif off
 * this same column and a future feature may set those independently - a blind
 * overwrite here would silently erase them the next time someone updated their images.
 */
export async function setBriefAssets(
  briefId: string,
  assets: {
    images: string[];
    brandColor?: string;
    imageDescriptions?: Record<string, string>;
    uiRecords?: Record<string, unknown>;
  },
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error: readError } = await supabase
    .from("briefs")
    .select("assets")
    .eq("id", briefId)
    .maybeSingle();
  if (readError) throw new Error(`setBriefAssets read failed: ${readError.message}`);
  const existing = (data as { assets: Record<string, unknown> | null } | null)?.assets ?? {};
  const merged: Record<string, unknown> = { ...existing, images: assets.images };
  if (assets.brandColor !== undefined) merged.brandColor = assets.brandColor;
  if (assets.imageDescriptions !== undefined) merged.imageDescriptions = assets.imageDescriptions;
  if (assets.uiRecords !== undefined) merged.uiRecords = assets.uiRecords;

  // Drop captions and extracted text for images that are no longer attached. Both are keyed by
  // staged filename, so without this they accumulate forever and a removed image keeps a
  // description describing it - and, worse, keeps text a scene would be allowed to render.
  const keep = new Set(assets.images.map((url) => url.split("?")[0].split("/").pop()));
  for (const field of ["imageDescriptions", "uiRecords"] as const) {
    const map = merged[field];
    if (map && typeof map === "object") {
      merged[field] = Object.fromEntries(
        Object.entries(map as Record<string, unknown>).filter(([file]) => {
          // An SVG is staged as .png, so match either spelling of the same object.
          return keep.has(file) || keep.has(file.replace(/\.png$/i, ".svg"));
        }),
      );
    }
  }

  const { error } = await supabase.from("briefs").update({ assets: merged }).eq("id", briefId);
  if (error) throw new Error(`setBriefAssets failed: ${error.message}`);
}

/**
 * Remove brand-asset objects from storage.
 *
 * The bucket is public, so leaving the file behind means its URL still resolves after the user
 * has "deleted" it. For an accidentally uploaded screenshot that is the whole point of deleting.
 * A missing object is success, not failure, so a retry after a partial removal is safe.
 */
export async function removeBrandAssetObjects(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const supabase = getSupabaseAdmin();
  const paths = urls
    .map((url) => {
      const marker = "/object/public/brand-assets/";
      const at = url.indexOf(marker);
      return at < 0 ? null : decodeURIComponent(url.slice(at + marker.length).split("?")[0]);
    })
    .filter((p): p is string => Boolean(p));
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from("brand-assets").remove(paths);
  if (error) throw new Error(`removeBrandAssetObjects failed: ${error.message}`);
}

/**
 * The brand assets a brief owns, in the shape the render worker expects.
 *
 * Read server-side at render time rather than trusted from the request body. The client never
 * sent them, so renders silently ran without the user's screenshots; and a body-supplied value
 * would let a caller aim a render at images belonging to somebody else.
 */
export async function getBriefAssets(
  briefId: string,
): Promise<Record<string, unknown> | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("briefs")
    .select("assets")
    .eq("id", briefId)
    .maybeSingle();
  if (error) throw new Error(`getBriefAssets failed: ${error.message}`);
  const assets = (data as { assets: Record<string, unknown> | null } | null)?.assets;
  return assets && Object.keys(assets).length > 0 ? assets : null;
}

/**
 * The verbatim on-screen text extracted for each of a brief's images, keyed by staged filename.
 *
 * Read back on every save for the same reason descriptions are: an image already read must not be
 * paid for again, and re-reading risks a different transcription of the same screenshot.
 */
export async function getBriefUiRecords(briefId: string): Promise<Record<string, never>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("briefs")
    .select("assets")
    .eq("id", briefId)
    .maybeSingle();
  if (error) throw new Error(`getBriefUiRecords failed: ${error.message}`);
  const records = (data as { assets: { uiRecords?: unknown } | null } | null)?.assets?.uiRecords;
  return records && typeof records === "object" ? (records as Record<string, never>) : {};
}

/** What we already know each of a brief's images shows, so re-uploading does not re-caption. */
export async function getBriefAssetDescriptions(
  briefId: string,
): Promise<Record<string, string>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("briefs")
    .select("assets")
    .eq("id", briefId)
    .maybeSingle();
  if (error) throw new Error(`getBriefAssetDescriptions failed: ${error.message}`);
  const assets = (data as { assets: { imageDescriptions?: unknown } | null } | null)?.assets;
  const descriptions = assets?.imageDescriptions;
  return descriptions && typeof descriptions === "object"
    ? (descriptions as Record<string, string>)
    : {};
}

/** Persist the render state (job id / status / finished MP4 URL) on a brief. */
export async function saveBriefRender(
  briefId: string,
  patch: {
    jobId?: string;
    status?: string;
    url?: string | null;
    expectedJobId?: string;
  },
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const row: Record<string, unknown> = {};
  if (patch.jobId !== undefined) row.render_job_id = patch.jobId;
  if (patch.status !== undefined) row.render_status = patch.status;
  if (patch.url !== undefined) row.render_url = patch.url;
  if (Object.keys(row).length === 0) return true;
  let query = supabase.from("briefs").update(row).eq("id", briefId);
  if (patch.expectedJobId !== undefined) {
    query = query.eq("render_job_id", patch.expectedJobId);
  }
  const { data, error } = await query.select("id");
  if (error) throw new Error(`saveBriefRender failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
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
  const now = new Date().toISOString();
  const { error } = await supabase.from("render_jobs").insert({
    id: args.id,
    brief_id: args.briefId,
    user_id: args.userId,
    // Reserve the job for the worker selected by this request. Recovery workers may only
    // reclaim it after the lease becomes stale, preventing two workers from rendering it.
    status: "processing",
    phase: "queued",
    progress: 0,
    input: args.input,
    started_at: now,
    locked_at: now,
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

/**
 * Claim the right to refund a failed render. Returns true for exactly one caller.
 *
 * The browser polls a job every 4 seconds and a user can have several tabs open, so a
 * refund written wherever the failure is *observed* pays out over and over. This is a
 * conditional update instead: `refunded_at is null` is part of the WHERE clause, so
 * Postgres picks the winner and every other caller gets zero rows back. No transaction and
 * no lock needed, because the guard is the update itself.
 *
 * Scoped to the owning user too, so a guessed job id cannot move somebody else's balance.
 */
export async function claimRenderRefund(jobId: string, userId: string): Promise<boolean> {
  const uid = realUserId(userId);
  // Local dev has no real wallet, so there is nothing to claim.
  if (!uid) return false;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("render_jobs")
    .update({ refunded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("user_id", uid)
    .eq("status", "error")
    .is("refunded_at", null)
    .select("id");
  if (error) throw new Error(`claimRenderRefund failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * The newest still-running job for a brief, or null. Used to make a repeated submit
 * return the job already in flight instead of reserving a second lot of credits.
 *
 * Scoped to the owning user as well as the brief, so a guessed brief id cannot reveal
 * somebody else's job. Ordered newest-first because a brief can accumulate terminal
 * jobs over time and only the latest matters.
 */
export async function findActiveRenderJob(
  briefId: string,
  userId: string,
): Promise<{ id: string; status: string; updatedAt: string | null } | null> {
  const uid = realUserId(userId);
  // Local dev has no real wallet and no durable jobs to collide with.
  if (!uid) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("render_jobs")
    .select("id,status,updated_at")
    .eq("brief_id", briefId)
    .eq("user_id", uid)
    .in("status", ["queued", "processing"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`findActiveRenderJob failed: ${error.message}`);
  const row = data?.[0];
  return row
    ? {
        id: row.id as string,
        status: row.status as string,
        updatedAt: (row.updated_at as string | null) ?? null,
      }
    : null;
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
