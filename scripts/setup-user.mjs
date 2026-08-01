// One-off setup helper: allowlist an email and (if possible) make them admin.
// Usage: node scripts/setup-user.mjs builder@example.com
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
    } catch {
      // file may not exist
    }
  }
  return env;
}

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) {
  console.error("Pass an email: node scripts/setup-user.mjs you@gmail.com");
  process.exit(1);
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  console.log(`\nSetting up: ${email}\n`);

  // 1) Allowlist the email (so they pass the approval gate on next sign-in).
  const { data: existingAllow } = await supabase
    .from("allowed_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingAllow) {
    console.log("[ok] already in allowed_users");
  } else {
    const { error: allowErr } = await supabase
      .from("allowed_users")
      .insert({ email, note: "setup script" });
    if (allowErr) {
      console.error("Could not write allowed_users:", allowErr.message);
      process.exit(1);
    }
    console.log("[ok] allowlisted in allowed_users");
  }

  // 2) Does migration 0010 (is_admin column) exist yet?
  const { error: adminColErr } = await supabase.from("profiles").select("is_admin").limit(1);
  const migration0010 = !adminColErr;
  console.log(
    migration0010
      ? "[ok] migration 0010 applied (profiles.is_admin exists)"
      : "[!!] migration 0010 NOT applied yet (profiles.is_admin missing) -> run the SQL, then re-run this script",
  );

  // 3) Is there already a profile for this email? (only after they've signed in once)
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, email, is_admin")
    .eq("email", email)
    .maybeSingle();

  if (!profile) {
    console.log(
      "[..] no profile yet -> sign in once with Google (you'll now reach /connect), then re-run to become admin",
    );
  } else if (!migration0010) {
    console.log("[..] profile exists but can't set admin until migration 0010 is applied");
  } else if (profile.is_admin) {
    console.log("[ok] already an admin - all set");
  } else {
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ is_admin: true })
      .eq("user_id", profile.user_id);
    if (updErr) {
      console.error("Could not set is_admin:", updErr.message);
      process.exit(1);
    }
    console.log("[ok] promoted to admin");
  }

  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
