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

/** Empty strings count as absent; a blank env var is a missing one, not a configured one. */
function present(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

export function resolveAuthConfig(env: AuthEnv, nodeEnv: string | undefined): AuthConfig {
  const missing: string[] = [];
  if (!present(env.url)) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!present(env.anonKey)) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (missing.length === 0) return { mode: "enforce" };

  // Production never degrades. A half-configured deploy fails closed and says why.
  if (nodeEnv === "production") return { mode: "misconfigured", missing };

  // A partially configured laptop is a mistake worth surfacing too: it is the exact
  // shape that used to look like "dev mode" and hid the bug in the first place.
  if (missing.length === 1) return { mode: "misconfigured", missing };

  return { mode: "dev-open" };
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
