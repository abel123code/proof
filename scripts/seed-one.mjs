// Insert a single reference_videos row for testing. Run: node scripts/seed-one.mjs <tiktokUrl>
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const postUrl = process.argv[2] ?? "https://www.tiktok.com/@tozy.zard/video/7645136084535381262";

const { data, error } = await supabase
  .from("reference_videos")
  .upsert(
    { url: postUrl, matched_query: "#buildinpublic", status: "pending" },
    { onConflict: "url" },
  )
  .select("id, url")
  .single();

if (error) {
  console.error("insert failed:", error.message);
  process.exit(1);
}
console.log("inserted reference_video:", data.id, data.url);
