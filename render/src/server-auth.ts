import { timingSafeEqual } from "node:crypto";

/**
 * Fail-CLOSED worker auth. The render worker holds the service-role key and renders arbitrary
 * model HTML; it must never be reachable unauthenticated on a public interface. The legacy behaviour
 * treated a missing `RENDER_TOKEN` as "allow everyone" and served the `/out` static dir to anyone —
 * this resolves that into an explicit, safe posture.
 */
export interface WorkerSecurityConfiguration {
  /** Interface to bind. Tokenless mode is forced onto loopback. */
  host: string;
  renderToken?: string;
  /** Only true in explicit local-dev mode (token unset + ALLOW_INSECURE_LOCAL_RENDER=true + loopback). */
  allowUnauthenticated: boolean;
  /** Only expose the `/out` static render dir in that same local-dev mode. */
  exposeLegacyOutput: boolean;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Resolve the worker's security posture at startup. A configured `RENDER_TOKEN` is the production
 * path (bind public, require the token, no `/out`). With no token, the ONLY way to boot is the
 * explicit escape hatch `ALLOW_INSECURE_LOCAL_RENDER=true` bound to loopback — anything else throws
 * so a misconfigured production box refuses to start rather than serving unauthenticated.
 */
export function resolveWorkerSecurityConfiguration(env: NodeJS.ProcessEnv): WorkerSecurityConfiguration {
  const renderToken = env.RENDER_TOKEN?.trim() || undefined;
  const insecureLocal = env.ALLOW_INSECURE_LOCAL_RENDER === "true";
  if (!renderToken) {
    if (!insecureLocal) {
      throw new Error("RENDER_TOKEN is required unless ALLOW_INSECURE_LOCAL_RENDER=true");
    }
    const host = env.RENDER_HOST?.trim() || "127.0.0.1";
    if (!LOOPBACK_HOSTS.has(host.toLowerCase())) {
      throw new Error("Tokenless render mode must bind to a loopback RENDER_HOST");
    }
    return { host, allowUnauthenticated: true, exposeLegacyOutput: true };
  }

  return {
    host: env.RENDER_HOST?.trim() || "0.0.0.0",
    renderToken,
    allowUnauthenticated: false,
    exposeLegacyOutput: false,
  };
}

/**
 * Constant-time token check. Returns `allowUnauthenticated` only when no token is configured (the
 * explicit local-dev posture); with a token, a request is authorized iff it presents the exact token.
 */
export function workerRequestAuthorized(
  sent: unknown,
  configured: string | undefined,
  allowUnauthenticated = false,
): boolean {
  if (!configured) return allowUnauthenticated;
  if (typeof sent !== "string") return false;
  const provided = Buffer.from(sent);
  const expected = Buffer.from(configured);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
