/**
 * Which of the three auth postures the current environment is in.
 *
 * The old check was a single boolean: "is auth configured?" If it was false the app
 * handed out a dev identity that passed every gate. That conflates two very different
 * situations. Nothing configured on a laptop is fine. Half configured in production is a
 * silent, total authorization bypass, because service-role database access still works
 * while the gate stops asking who anyone is.
 */
export type AuthConfig =
  | { mode: "enforce" }
  | { mode: "dev-open" }
  | { mode: "misconfigured"; missing: string[] };

export interface AuthEnv {
  url: string | undefined;
  anonKey: string | undefined;
}

/**
 * Empty strings count as absent, and so does the literal text "undefined"/"null" —
 * env templating and some CI setups stringify a missing value that way, and that
 * must not read as a configured key.
 */
function present(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();
  return lowered !== "undefined" && lowered !== "null";
}

/** Environments allowed to fall back to the dev identity when nothing is configured. */
const DEV_OPEN_NODE_ENVS = new Set(["development", "test"]);

export function resolveAuthConfig(env: AuthEnv, nodeEnv: string | undefined): AuthConfig {
  const missing: string[] = [];
  if (!present(env.url)) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!present(env.anonKey)) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (missing.length === 0) return { mode: "enforce" };

  // A partially configured environment is always a mistake, regardless of nodeEnv:
  // it is the exact shape that used to look like "dev mode" and hid the bug in the
  // first place.
  if (missing.length === 1) return { mode: "misconfigured", missing };

  // Only development and test may unlock the dev-open fallback. This is an
  // allowlist, not an exact match on "production" — an unset, empty, mistyped, or
  // staging NODE_ENV must fail closed rather than quietly read as a developer laptop.
  if (nodeEnv && DEV_OPEN_NODE_ENVS.has(nodeEnv)) return { mode: "dev-open" };

  return { mode: "misconfigured", missing };
}

/** Reads the live environment. Kept separate so the decision above stays pure. */
export function currentAuthConfig(): AuthConfig {
  return resolveAuthConfig(
    {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    process.env.NODE_ENV,
  );
}
