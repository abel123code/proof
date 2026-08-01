import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEV_USER_ID, getProfile, isAdminUser, type Profile } from "@/lib/db";

/**
 * Auth is only enforced when the anon key is configured. Locally (or before the
 * Google OAuth provider is wired in the Supabase dashboard) it degrades to a
 * single "dev" identity so the pipeline stays usable.
 */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export interface AuthedUser {
  id: string;
  email: string | null;
  githubUsername: string | null;
}

/** The signed-in Supabase user, or null. Returns a dev identity if auth is off. */
export async function getAuthUser(): Promise<AuthedUser | null> {
  if (!isAuthConfigured()) {
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
  if (!isAuthConfigured()) {
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
  if (!isAuthConfigured()) {
    return { ok: true, userId: DEV_USER_ID, profile: null };
  }
  const user = await getAuthUser();
  if (!user) return { ok: false, status: 401, error: "Please sign in." };
  if (!(await isAdminUser(user.id))) {
    return { ok: false, status: 403, error: "Admin access required." };
  }
  return { ok: true, userId: user.id, profile: null };
}
