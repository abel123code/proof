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
  const { data, error } = await supabase.from("access_requests").select("*");
  console.log("\n=== access_requests ===");
  if (error) console.error("error:", error.message);
  for (const r of data ?? []) console.log(JSON.stringify(r));
  console.log(`(${data?.length ?? 0} rows)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
