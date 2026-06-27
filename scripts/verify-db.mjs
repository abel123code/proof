// Quick connectivity + schema check. Run: node scripts/verify-db.mjs
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
console.log("URL:", url);

const supabase = createClient(url, key, { auth: { persistSession: false } });

const tables = ["projects", "reference_videos", "briefs", "scripts", "captures", "transcripts", "renders"];
let allOk = true;
for (const t of tables) {
  const { error } = await supabase.from(t).select("*", { count: "exact", head: true });
  if (error) {
    allOk = false;
    console.log(`  [missing] ${t}: ${error.message}`);
  } else {
    console.log(`  [ok]      ${t}`);
  }
}
console.log(allOk ? "\nSchema looks applied." : "\nSchema NOT fully applied - run supabase/migrations/0001_init.sql in the SQL Editor.");
