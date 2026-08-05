import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEV_USER_ID, getProfile, isAdminUser, type Profile } from "@/lib/db";
import { currentAuthConfig, type AuthConfig } from "@/lib/auth-config";

/**
 * Auth is only enforced when both Supabase public env vars are configured. Locally
 * (or before the Google OAuth provider is wired in the Supabase dashboard) it
 * degrades to a single "dev" identity so the pipeline stays usable. A half-configured
 * environment (one var present, one missing) is never treated as dev mode — it is
 * refused, because in production that shape used to silently disable auth while
 * service-role database access kept working.
 */
export function isAuthConfigured(): boolean {
  return currentAuthConfig().mode === "enforce";
}

export interface AuthedUser {
  id: string;
  email: string | null;
  githubUsername: string | null;
}

/** The signed-in Supabase user, or null. Returns a dev identity if auth is off. */
export async function getAuthUser(): Promise<AuthedUser | null> {
  const config = currentAuthConfig();
  if (config.mode === "misconfigured") return null;
  if (config.mode === "dev-open") {
    return { id: DEV_USER_ID, email: null, githubUsername: "dev" };
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    githubUsername:
      (user.user_metadata?.user_name as string | undefined) ??
      (user.user_metadata?.preferred_username as string | undefined) ??
      null,
  };
}

export type AuthResult =
  | { ok: true; userId: string; profile: Profile | null }
  | { ok: false; status: number; error: string };

/**
 * Shared by both gates below: logs which env var(s) are missing (so the cause is
 * visible in provider logs, not just "500 somewhere") and returns the 503 that
 * tells the caller this is a server problem, not a credentials problem — retrying
 * later may work, retrying with different credentials will not.
 */
function misconfiguredResult(config: Extract<AuthConfig, { mode: "misconfigured" }>): AuthResult {
  console.error(`auth misconfigured, missing: ${config.missing.join(", ")}`);
  return { ok: false, status: 503, error: "Sign-in is unavailable. Please try again shortly." };
}

/**
 * Gate for API routes / server actions: requires a signed-in AND approved user.
 * When auth is disabled (dev-open), always passes with the dev user id. When the
 * environment is only half configured, fails closed with a 503 rather than either
 * enforcing (impossible — there's no working Supabase client) or opening up.
 *
 * Returns the loaded profile so callers (e.g. /api/profile) can reuse it instead
 * of issuing a second identical DB query. In dev (auth off) there is no profile.
 */
export async function requireApprovedUser(): Promise<AuthResult> {
  const config = currentAuthConfig();
  if (config.mode === "misconfigured") return misconfiguredResult(config);
  if (config.mode === "dev-open") {
    return { ok: true, userId: DEV_USER_ID, profile: null };
  }
  const user = await getAuthUser();
  if (!user) return { ok: false, status: 401, error: "Please sign in." };
  const profile = await getProfile(user.id);
  if (!profile) {
    return { ok: false, status: 403, error: "Your account is pending approval." };
  }
  return { ok: true, userId: user.id, profile };
}

/**
 * Stricter gate for admin-only routes: signed in, approved, AND flagged admin.
 * In dev-open it passes so the /admin tools are usable locally. A half-configured
 * environment fails closed with a 503, same as requireApprovedUser.
 */
export async function requireAdmin(): Promise<AuthResult> {
  const config = currentAuthConfig();
  if (config.mode === "misconfigured") return misconfiguredResult(config);
  if (config.mode === "dev-open") {
    return { ok: true, userId: DEV_USER_ID, profile: null };
  }
  const user = await getAuthUser();
  if (!user) return { ok: false, status: 401, error: "Please sign in." };
  if (!(await isAdminUser(user.id))) {
    return { ok: false, status: 403, error: "Admin access required." };
  }
  return { ok: true, userId: user.id, profile: null };
}
