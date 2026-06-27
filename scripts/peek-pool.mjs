// Show newest reference rows. Run: node scripts/peek-pool.mjs
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data, error } = await supabase
  .from("reference_videos")
  .select("author, caption, matched_query, views, created_at")
  .order("created_at", { ascending: false })
  .limit(15);

if (error) {
  console.error(error.message);
  process.exit(1);
}
for (const r of data) {
  console.log(`@${r.author ?? "?"}  [${r.matched_query ?? "-"}]  ${r.views ?? "-"} views`);
  console.log(`   ${(r.caption ?? "").slice(0, 120)}`);
}
