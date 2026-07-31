import { createHmac, timingSafeEqual } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { optionalEnv, requireEnv } from "@/lib/env";

/**
 * GitHub App access for PRIVATE repositories.
 *
 * Why an App and not an OAuth App: the OAuth `repo` scope is all-or-nothing read **and write** across
 * every private repository the user can see. An App is installed on repositories the user picks in
 * GitHub's own UI, so GitHub, not Proof, enforces the boundary, and the consent screen names the
 * exact repos. We request only `metadata: read` and `contents: read`.
 *
 * What we persist: the installation id, which is not a credential. Access tokens are minted per
 * request from the app private key, expire in ~1 hour, and are never stored or logged.
 */

/** True when the App credentials are configured; lets the whole feature degrade to public-only. */
export function githubAppConfigured(): boolean {
  return Boolean(
    optionalEnv("GITHUB_APP_ID") &&
      optionalEnv("GITHUB_APP_PRIVATE_KEY") &&
      optionalEnv("GITHUB_APP_SLUG"),
  );
}

/**
 * Private keys are PEM files. Env vars can't hold raw newlines, so `\n` escapes are the convention;
 * restore them or the JWT signing fails with an opaque error.
 */
export function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/** The public install URL for this App. */
export function installUrl(state: string): string {
  const slug = requireEnv("GITHUB_APP_SLUG");
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}

/**
 * The install redirect round-trips through github.com, so the `state` has to prove on return that
 * *we* started the flow for *this* user (CSRF: otherwise an attacker could hand a victim a callback
 * URL that binds the attacker's installation to the victim's account).
 */
export function signState(userId: string, issuedAtMs: number): string {
  const secret = requireEnv("SUPABASE_SERVICE_ROLE_KEY"); // server-only, never shipped to the client
  const payload = `${userId}.${issuedAtMs}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

const STATE_TTL_MS = 15 * 60 * 1000;

/** Verify a returned state and recover the user id. Returns null when invalid or expired. */
export function verifyState(state: string, nowMs: number): string | null {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [userId, issuedAtRaw, sig] = parts;
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return null;
  if (nowMs - issuedAt > STATE_TTL_MS || nowMs < issuedAt - 60_000) return null;

  const expected = createHmac("sha256", requireEnv("SUPABASE_SERVICE_ROLE_KEY"))
    .update(`${userId}.${issuedAtRaw}`)
    .digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}

/**
 * An Octokit scoped to ONE installation. The token is minted here, used for this request, and
 * discarded, it is never returned to the caller or written anywhere.
 */
export function installationOctokit(installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: requireEnv("GITHUB_APP_ID"),
      privateKey: normalizePrivateKey(requireEnv("GITHUB_APP_PRIVATE_KEY")),
      installationId,
    },
  });
}

/** A repo reachable through the installation. Shape matches the public picker's rows. */
export interface InstallationRepo {
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  pushedAt: string | null;
  isPrivate: true;
}

/**
 * Repos this installation can actually see, i.e. exactly what the user ticked during install.
 * Only private ones are returned; public repos already arrive through the unauthenticated path, and
 * returning both would duplicate rows in the picker.
 */
export async function listInstallationRepos(installationId: number): Promise<InstallationRepo[]> {
  const gh = installationOctokit(installationId);
  const { data } = await gh.apps.listReposAccessibleToInstallation({ per_page: 100 });
  return data.repositories
    .filter((r) => r.private)
    .map((r) => ({
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      description: r.description,
      language: r.language ?? null,
      stars: r.stargazers_count ?? 0,
      pushedAt: r.pushed_at ?? null,
      isPrivate: true as const,
    }));
}

/**
 * May this user analyse `owner/repo`?
 *
 * Proof's premise is "prove YOU built it", so you analyse your own work. Enforced for two reasons
 * beyond authenticity: the repo picker runs on ONE shared server token (5000 req/hr for the whole
 * app), so an open handle field lets a single user exhaust GitHub's rate limit for everybody, and
 * an approved user could otherwise burn credits generating a video about someone else's project.
 *
 * Pure, so both routes share one rule and every branch is testable.
 */
export function canAnalyseRepo(args: {
  owner: string;
  profileHandle: string | null;
  /** True when the repo is reachable through the user's own GitHub App installation. */
  grantedByInstallation?: boolean;
}): boolean {
  if (args.grantedByInstallation) return true;
  const handle = args.profileHandle?.trim().toLowerCase();
  if (!handle) return false;
  return args.owner.trim().toLowerCase() === handle;
}

export type InstallCallbackDecision =
  | { ok: true }
  | {
      ok: false;
      reason: "missing_installation" | "state_invalid" | "set_handle_first" | "owner_mismatch";
    };

/**
 * Should this install callback be trusted? Pure, so every branch is unit-testable.
 *
 * Two ways a user can arrive:
 *  - from our button, carrying a signed `state` that names them. Trust that, but it must match the
 *    session or a crafted link could attach an attacker's installation to whoever clicks it.
 *  - straight from github.com/apps/<slug>, where GitHub uses the app's setup URL and there is no
 *    state at all. Rejecting would strand a real installation, so fall back to proving OWNERSHIP:
 *    the installation must belong to the GitHub handle already saved on this user's profile.
 */
export function decideInstallCallback(args: {
  installationId: number;
  stateUserId: string | null;
  sessionUserId: string;
  profileHandle: string | null;
  /** Owner login of the installation. Only consulted on the stateless path. */
  installationOwner: string | null;
}): InstallCallbackDecision {
  const { installationId, stateUserId, sessionUserId, profileHandle, installationOwner } = args;

  if (!Number.isInteger(installationId) || installationId <= 0) {
    return { ok: false, reason: "missing_installation" };
  }
  if (stateUserId) {
    return stateUserId === sessionUserId ? { ok: true } : { ok: false, reason: "state_invalid" };
  }
  const handle = profileHandle?.trim().toLowerCase();
  if (!handle) return { ok: false, reason: "set_handle_first" };
  if (!installationOwner || installationOwner.trim().toLowerCase() !== handle) {
    return { ok: false, reason: "owner_mismatch" };
  }
  return { ok: true };
}

/**
 * The GitHub account an installation belongs to (app-level auth, not installation auth).
 *
 * Used to verify ownership when a user installs straight from github.com/apps/<slug>: there is no
 * signed state of ours in that redirect, so instead we require the installation to belong to the
 * GitHub handle already saved on their profile.
 */
export async function installationAccountLogin(installationId: number): Promise<string | null> {
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: requireEnv("GITHUB_APP_ID"),
      privateKey: normalizePrivateKey(requireEnv("GITHUB_APP_PRIVATE_KEY")),
    },
  });
  const { data } = await appOctokit.apps.getInstallation({ installation_id: installationId });
  const account = data.account as { login?: string; slug?: string } | null;
  return account?.login ?? account?.slug ?? null;
}

/**
 * Does this installation cover `owner/repo`? Checked before a private snapshot so a user cannot
 * point Proof at a repo their installation was never granted (GitHub would answer 404 anyway, but
 * failing here gives an honest error instead of an empty snapshot).
 */
export async function installationCanAccess(
  installationId: number,
  owner: string,
  repo: string,
): Promise<boolean> {
  const gh = installationOctokit(installationId);
  const { data } = await gh.apps.listReposAccessibleToInstallation({ per_page: 100 });
  const target = `${owner}/${repo}`.toLowerCase();
  return data.repositories.some((r) => r.full_name.toLowerCase() === target);
}
