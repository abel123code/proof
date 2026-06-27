import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data } = await supabase
  .from("reference_videos")
  .select("author, caption, status, url")
  .order("created_at", { ascending: false });

const byStatus = {};
for (const r of data) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
console.log("total:", data.length, "byStatus:", byStatus);
const tozy = data.find((r) => r.url.includes("tozy.zard"));
console.log("tozy.zard present:", !!tozy, tozy ? `(status: ${tozy.status})` : "");
console.log("\nremaining captions:");
for (const r of data) console.log(`  [${r.status}] @${r.author ?? "?"}: ${(r.caption ?? "(no caption)").slice(0, 90)}`);
