// One-off: set a specific user's credits_total by email. Preserves credits_used.
// Usage: node scripts/set-credits.mjs <email> <total>
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const env = {};
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in env)) env[m[1]] = m[2];
      }
    } catch {}
  }
  return env;
}

const email = (process.argv[2] ?? "").toLowerCase();
const total = Number(process.argv[3]);
if (!email || !Number.isFinite(total)) {
  console.error("Usage: node scripts/set-credits.mjs <email> <total>");
  process.exit(1);
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("user_id, email");
  if (pErr) throw new Error(`list profiles failed: ${pErr.message}`);
  const profile = (profiles ?? []).find((p) => (p.email ?? "").toLowerCase() === email);
  if (!profile) throw new Error(`no profile for ${email}`);

  await supabase
    .from("usage")
    .upsert({ user_id: profile.user_id, credits_total: total }, { onConflict: "user_id" });

  const { data: row } = await supabase
    .from("usage")
    .select("credits_total, credits_used")
    .eq("user_id", profile.user_id)
    .maybeSingle();
  console.log(
    `\n${email}: credits_total=${row?.credits_total}, credits_used=${row?.credits_used}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
