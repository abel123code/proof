import { NextResponse } from "next/server";
import { runTikTokScraper, type ScrapedClip } from "@/lib/apify";
import { classifyFounderStory } from "@/lib/relevance";
import { upsertReferenceVideos } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

// Target genre (spec lines 10, 15): FOUNDER STORYTELLING - a builder narrating the
// story of the software/tech product they built (origin, why, the journey, progress).
// Not tutorials, not generic dev tips - personal first-person project stories.
const GENRE_HASHTAGS = [
  "buildinpublic",
  "indiehacker",
  "indiehackers",
  "founderstory",
  "foundersjourney",
  "startupstory",
  "startupjourney",
  "solofounder",
  "mystartup",
  "saasfounder",
  "ibuiltthis",
];

// Heavy on first-person "I built ..." phrasings - that's exactly the demo angle
// (a founder narrating the product they shipped).
const GENRE_SEARCHES = [
  "I built an app",
  "I built a website",
  "I built a saas",
  "I built this app",
  "I built my own app",
  "I made an app",
  "I created an app",
  "I coded an app",
  "the app I built",
  "I launched my app",
  "how I built my app",
  "I built a startup",
  "why I built this app",
  "the story behind my startup",
];

// Cheap pre-filter: obvious off-genre signals (crafts, art, lifestyle) dropped for free
// before spending an LLM call.
const DENY = [
  "clay",
  "foam",
  "polymer",
  "paint",
  "crochet",
  "knit",
  "sew",
  "makeup",
  "skincare",
  "recipe",
  "cooking",
  "bake",
  "outfit",
  "fashion",
  "diy",
  "renovation",
  "kitchen",
  "candle",
  "resin",
  "drawing",
  "sketch",
  "workout",
  "gym",
];

function obviouslyOffGenre(caption: string): boolean {
  const c = caption.toLowerCase();
  return DENY.some((d) => c.includes(d));
}

// We always keep at least this many of the top-performing relevant clips, even if
// they fall under the view floor - so a strict floor can never empty the pool.
const MIN_KEEP = 12;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const resultsPerPage: number =
      typeof body?.resultsPerPage === "number" ? body.resultsPerPage : 12;
    // Favor well-performing clips. Default floor is modest; the fallback below
    // guarantees we still keep the top performers if too few clear the bar.
    const minViews: number =
      typeof body?.minViews === "number" ? body.minViews : 20_000;

    // Tag each clip with the query/hashtag it matched (first match wins for dedupe).
    const tagged = new Map<string, ScrapedClip & { matchedQuery: string }>();

    const collect = (clips: ScrapedClip[], matchedQuery: string) => {
      for (const clip of clips) {
        if (obviouslyOffGenre(clip.caption ?? "")) continue;
        if (!tagged.has(clip.url)) tagged.set(clip.url, { ...clip, matchedQuery });
      }
    };

    // One unit of work per query. Hashtag and search feeds are scraped the same way.
    const jobs: { run: () => Promise<ScrapedClip[]>; tag: string }[] = [
      ...GENRE_HASHTAGS.map((h) => ({
        run: () => runTikTokScraper({ hashtags: [h], resultsPerPage }),
        tag: `#${h}`,
      })),
      ...GENRE_SEARCHES.map((s) => ({
        run: () => runTikTokScraper({ searchQueries: [s], resultsPerPage }),
        tag: s,
      })),
    ];

    // Limited concurrency: fast enough for ~25 queries without tripping Apify's
    // concurrent-run limits. A single failing query shouldn't sink the whole scrape.
    const CONCURRENCY = 4;
    let cursor = 0;
    async function worker() {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          collect(await job.run(), job.tag);
        } catch (e) {
          console.error(`scrape query failed (${job.tag}):`, e);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const candidates = [...tagged.values()];
    const keep = await classifyFounderStory(candidates.map((c) => c.caption ?? ""));
    const relevant = candidates
      .filter((_, i) => keep.has(i))
      // Best-performing first, so the view floor / fallback keeps the strongest clips.
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

    // Prefer clips above the view floor; if too few clear it, fall back to the
    // top-N performers so the pool is never starved and the demo stays strong.
    const aboveFloor = relevant.filter((c) => (c.views ?? 0) >= minViews);
    const chosen = aboveFloor.length >= MIN_KEEP ? aboveFloor : relevant.slice(0, MIN_KEEP);

    const inserted = await upsertReferenceVideos(chosen);

    return NextResponse.json({
      scrapedCandidates: candidates.length,
      keptRelevant: relevant.length,
      aboveFloor: aboveFloor.length,
      minViews,
      kept: chosen.length,
      inserted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
