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

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const { data: authList, error: authErr } = await supabase.auth.admin.listUsers();
  if (authErr) console.error("auth list error:", authErr.message);
  console.log("\n=== auth.users ===");
  for (const u of authList?.users ?? []) {
    console.log(JSON.stringify({ id: u.id, email: u.email, provider: u.app_metadata?.provider }));
  }

  const { data: allow } = await supabase.from("allowed_users").select("*");
  console.log("\n=== allowed_users ===");
  for (const a of allow ?? []) console.log(JSON.stringify(a));

  const { data: profiles } = await supabase.from("profiles").select("user_id, email, is_admin");
  console.log("\n=== profiles ===");
  for (const p of profiles ?? []) console.log(JSON.stringify(p));

  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
