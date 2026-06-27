// Cheap Apify smoke test: one hashtag, few results. Run: node scripts/test-apify.mjs
import "dotenv/config";
import { ApifyClient } from "apify-client";

const token = process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN;
if (!token) {
  console.error("Missing APIFY_API_TOKEN");
  process.exit(1);
}

const client = new ApifyClient({ token });
const actor = process.env.TIKTOK_ACTOR || "clockworks/tiktok-scraper";
console.log("Actor:", actor);

const run = await client.actor(actor).call({
  hashtags: ["buildinpublic"],
  resultsPerPage: 3,
  shouldDownloadVideos: false,
  shouldDownloadCovers: false,
  shouldDownloadSubtitles: false,
});

const { items } = await client.dataset(run.defaultDatasetId).listItems();
console.log("Items returned:", items.length);
for (const it of items.slice(0, 3)) {
  console.log("---");
  console.log("url:", it.webVideoUrl ?? it.videoUrl ?? null);
  console.log("downloadUrl:", it.videoUrl ?? it.mediaUrls?.[0] ?? it.videoMeta?.downloadAddr ?? null);
  console.log("author:", it.authorMeta?.name ?? null);
  console.log("caption:", (it.text ?? "").slice(0, 80));
  console.log("views:", it.playCount ?? null, "likes:", it.diggCount ?? null);
}
