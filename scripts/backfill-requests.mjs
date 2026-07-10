// Backfill access_requests for anyone who signed in (auth.users) but is neither
// allowlisted nor has a profile - i.e. users the buggy upsert failed to record.
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
  const { data: authList } = await supabase.auth.admin.listUsers();
  const { data: allowed } = await supabase.from("allowed_users").select("email");
  const { data: profiles } = await supabase.from("profiles").select("user_id");
  const { data: requests } = await supabase.from("access_requests").select("email");

  const allowedSet = new Set((allowed ?? []).map((a) => (a.email ?? "").toLowerCase()));
  const profileSet = new Set((profiles ?? []).map((p) => p.user_id));
  const requestSet = new Set((requests ?? []).map((r) => (r.email ?? "").toLowerCase()));

  let added = 0;
  for (const u of authList?.users ?? []) {
    const email = (u.email ?? "").toLowerCase();
    if (!email) continue;
    if (profileSet.has(u.id) || allowedSet.has(email) || requestSet.has(email)) continue;

    const { error } = await supabase
      .from("access_requests")
      .insert({ email, github_username: null, status: "pending" });
    if (error) {
      console.error(`  [fail] ${email}: ${error.message}`);
    } else {
      console.log(`  [added] ${email}`);
      added++;
    }
  }

  console.log(`\nDone. Added ${added} pending request(s).\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
