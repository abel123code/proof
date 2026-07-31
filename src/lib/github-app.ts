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
