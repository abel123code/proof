// Env loading for the standalone render service.
// Locally we pull keys from the repo-root .env.local (where the Next app's keys live).
// On Zo the vars are set in the process environment directly, so dotenv just no-ops.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

// Try the repo-root env files in order; first one that exists wins. Harmless if none exist.
for (const candidate of ["../../.env.local", "../../.env", "../.env.local", "../.env"]) {
  const p = resolve(here, candidate);
  if (existsSync(p)) {
    config({ path: p });
    break;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** Supabase URL — accepts either the Next public name or a plain SUPABASE_URL (Zo). */
export function supabaseUrl(): string {
  return (
    optionalEnv("SUPABASE_URL") ??
    requireEnv("NEXT_PUBLIC_SUPABASE_URL")
  );
}
