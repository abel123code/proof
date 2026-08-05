import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEV_USER_ID, getProfile, isAdminUser, type Profile } from "@/lib/db";
import { currentAuthConfig } from "@/lib/auth-config";

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
 * Gate for API routes / server actions: requires a signed-in AND approved user.
 * When auth is disabled (dev), always passes with the dev user id.
 *
 * Returns the loaded profile so callers (e.g. /api/profile) can reuse it instead
 * of issuing a second identical DB query. In dev (auth off) there is no profile.
 */
export async function requireApprovedUser(): Promise<AuthResult> {
  const config = currentAuthConfig();
  if (config.mode === "misconfigured") {
    console.error(`auth misconfigured, missing: ${config.missing.join(", ")}`);
    return { ok: false, status: 503, error: "Sign-in is unavailable. Please try again shortly." };
  }
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
 * In dev (auth off) it passes so the /admin tools are usable locally.
 */
export async function requireAdmin(): Promise<AuthResult> {
  const config = currentAuthConfig();
  if (config.mode === "misconfigured") {
    console.error(`auth misconfigured, missing: ${config.missing.join(", ")}`);
    return { ok: false, status: 503, error: "Sign-in is unavailable. Please try again shortly." };
  }
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
