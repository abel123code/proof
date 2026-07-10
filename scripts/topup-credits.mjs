// One-off: bring existing users up to the new free-tier balance. New users are
// seeded at STARTING_CREDITS on first use, but rows created before the bump (and
// any user who never triggered a usage row) sit at the old default. This raises
// every profile's credits_total to at least TARGET, without touching credits_used.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const TARGET = Number(process.env.FREE_CREDITS ?? 4500);

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
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("user_id, email");
  if (pErr) throw new Error(`list profiles failed: ${pErr.message}`);

  const { data: usageRows, error: uErr } = await supabase
    .from("usage")
    .select("user_id, credits_total, credits_used");
  if (uErr) throw new Error(`list usage failed: ${uErr.message}`);

  const usageByUser = new Map((usageRows ?? []).map((r) => [r.user_id, r]));

  let raised = 0;
  let created = 0;
  for (const p of profiles ?? []) {
    const existing = usageByUser.get(p.user_id);
    if (!existing) {
      const { error } = await supabase
        .from("usage")
        .insert({ user_id: p.user_id, credits_total: TARGET, credits_used: 0 });
      if (error) {
        console.error(`  [fail] ${p.email ?? p.user_id}: ${error.message}`);
      } else {
        console.log(`  [created] ${p.email ?? p.user_id} -> ${TARGET}`);
        created++;
      }
      continue;
    }
    if (existing.credits_total >= TARGET) {
      console.log(`  [skip] ${p.email ?? p.user_id} already ${existing.credits_total}`);
      continue;
    }
    const { error } = await supabase
      .from("usage")
      .update({ credits_total: TARGET })
      .eq("user_id", p.user_id);
    if (error) {
      console.error(`  [fail] ${p.email ?? p.user_id}: ${error.message}`);
    } else {
      console.log(`  [raised] ${p.email ?? p.user_id}: ${existing.credits_total} -> ${TARGET}`);
      raised++;
    }
  }

  console.log(`\nDone. Raised ${raised}, created ${created}, target ${TARGET}.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
