import { ApifyClient } from "apify-client";
import { optionalEnv } from "@/lib/env";

/** Actor used to scrape TikTok. */
export const TIKTOK_ACTOR = "clockworks/tiktok-scraper";

function getToken(): string {
  // Support both names; the project's .env uses APIFY_API_TOKEN.
  const token = optionalEnv("APIFY_API_TOKEN") ?? optionalEnv("APIFY_TOKEN");
  if (!token) {
    throw new Error("Missing APIFY_API_TOKEN (or APIFY_TOKEN) in environment.");
  }
  return token;
}

let cached: ApifyClient | null = null;

export function getApify(): ApifyClient {
  if (cached) return cached;
  cached = new ApifyClient({ token: getToken() });
  return cached;
}

/** Normalized clip returned from a scrape, before persistence. */
export interface ScrapedClip {
  url: string;
  downloadUrl: string | null;
  thumbnail: string | null;
  author: string | null;
  caption: string | null;
  views: number | null;
  likes: number | null;
}

// The actor's item shape varies; pick fields defensively.
interface RawTikTokItem {
  webVideoUrl?: string;
  videoUrl?: string;
  mediaUrls?: string[];
  videoMeta?: {
    downloadAddr?: string;
    coverUrl?: string;
    originalCoverUrl?: string;
    cover?: string;
    dynamicCover?: string;
  };
  covers?: string[] | { default?: string; origin?: string; dynamic?: string };
  cover?: string;
  text?: string;
  authorMeta?: { name?: string; nickName?: string; avatar?: string };
  playCount?: number;
  diggCount?: number;
}

/** Pull the first usable cover/thumbnail URL from the (variable) item shape. */
function extractThumbnail(item: RawTikTokItem): string | null {
  const covers = item.covers;
  const fromCovers = Array.isArray(covers)
    ? covers[0]
    : (covers?.default ?? covers?.origin ?? covers?.dynamic);
  const candidates = [
    item.videoMeta?.coverUrl,
    item.videoMeta?.originalCoverUrl,
    item.videoMeta?.cover,
    item.videoMeta?.dynamicCover,
    fromCovers,
    item.cover,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }
  return null;
}

function mapItem(item: RawTikTokItem): ScrapedClip | null {
  const url = item.webVideoUrl ?? item.videoUrl ?? null;
  if (!url) return null;
  const downloadUrl =
    item.videoUrl ?? item.mediaUrls?.[0] ?? item.videoMeta?.downloadAddr ?? null;
  return {
    url,
    downloadUrl,
    thumbnail: extractThumbnail(item),
    author: item.authorMeta?.name ?? item.authorMeta?.nickName ?? null,
    caption: item.text ?? null,
    views: typeof item.playCount === "number" ? item.playCount : null,
    likes: typeof item.diggCount === "number" ? item.diggCount : null,
  };
}

export interface ScrapeInput {
  hashtags?: string[];
  searchQueries?: string[];
  resultsPerPage?: number;
}

/** Run the TikTok scraper actor and return normalized clips (metadata only). */
export async function runTikTokScraper(input: ScrapeInput): Promise<ScrapedClip[]> {
  const client = getApify();
  const run = await client.actor(TIKTOK_ACTOR).call({
    hashtags: input.hashtags ?? [],
    searchQueries: input.searchQueries ?? [],
    resultsPerPage: input.resultsPerPage ?? 20,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return (items as RawTikTokItem[])
    .map(mapItem)
    .filter((c): c is ScrapedClip => c !== null);
}

/**
 * On-demand fetch of a usable, downloadable video URL for a single TikTok post.
 * Re-runs the actor for just this URL with downloads enabled (so Apify hosts the
 * file and returns a fetchable URL). Used right before Gemini analysis so the
 * pool itself stays metadata-only.
 */
export async function fetchDownloadableUrl(postUrl: string): Promise<string | null> {
  const client = getApify();
  const run = await client.actor(TIKTOK_ACTOR).call({
    postURLs: [postUrl],
    resultsPerPage: 1,
    shouldDownloadVideos: true,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const it = items[0] as RawTikTokItem | undefined;
  if (!it) return null;
  return it.mediaUrls?.[0] ?? it.videoUrl ?? it.videoMeta?.downloadAddr ?? null;
}
