import { NextResponse } from "next/server";
import { runTikTokScraper, type ScrapedClip } from "@/lib/apify";
import { classifyTopicRelevant } from "@/lib/relevance";
import { buildSeedTerms } from "@/lib/seed";
import { listReferenceVideosByQuery, upsertReferenceVideos } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

// Topic-driven discovery: given the trend the user picked, find TikToks ALREADY
// doing well on that theme, so the best one's structure can ground the script.
// The verbose trend is first distilled into short SEED TERMS (real TikTok search
// phrases); we search those, then a light LLM pass keeps on-theme clips and ranks
// by views. The pool is never left empty for the demo.

const MIN_KEEP = 8;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const topic: unknown = body?.topic;
    if (typeof topic !== "string" || !topic.trim()) {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }
    const context: string | undefined =
      typeof body?.context === "string" ? body.context : undefined;
    const resultsPerPage: number =
      typeof body?.resultsPerPage === "number" ? body.resultsPerPage : 12;
    const minViews: number = typeof body?.minViews === "number" ? body.minViews : 10_000;

    // Distill the verbose trend into short, searchable seed terms.
    const { theme, searchTerms } = await buildSeedTerms({ topic, context });

    const tagged = new Map<string, ScrapedClip>();
    const collect = (clips: ScrapedClip[]) => {
      for (const clip of clips) {
        if (!tagged.has(clip.url)) tagged.set(clip.url, clip);
      }
    };

    const jobs = searchTerms.map((q) => () =>
      runTikTokScraper({ searchQueries: [q], resultsPerPage }),
    );

    // Limited concurrency so a few queries don't trip Apify's concurrent-run limits.
    const CONCURRENCY = 3;
    let cursor = 0;
    async function worker() {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          collect(await job());
        } catch (e) {
          console.error("topic scrape query failed:", e);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const candidates = [...tagged.values()].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

    // Light LLM relevance pass against the short THEME (not the verbose sentence).
    // Non-fatal: if the classifier errors/times out, keep all candidates so the
    // scrape still returns a usable pool instead of 500ing.
    let relevant: ScrapedClip[];
    try {
      const keep = await classifyTopicRelevant(
        candidates.map((c) => c.caption ?? ""),
        theme,
      );
      relevant = candidates.filter((_, i) => keep.has(i));
    } catch (e) {
      console.error("classifyTopicRelevant failed, keeping all candidates:", e);
      relevant = candidates;
    }

    // Resilient selection: prefer on-theme clips above the view floor, but never
    // return an empty grid - fall back to relevant, then to top candidates.
    const aboveFloor = relevant.filter((c) => (c.views ?? 0) >= minViews);
    let chosen: ScrapedClip[];
    if (aboveFloor.length >= MIN_KEEP) chosen = aboveFloor;
    else if (relevant.length > 0) chosen = relevant.slice(0, Math.max(MIN_KEEP, relevant.length));
    else chosen = candidates.slice(0, MIN_KEEP);

    // Persist tagged with the topic so the clips page can reload this set.
    const withTopic = chosen.map((c) => ({ ...c, matchedQuery: topic }));
    await upsertReferenceVideos(withTopic);

    // Return the full current set for this topic (new + any existing), ranked.
    const clips = await listReferenceVideosByQuery(topic);

    return NextResponse.json({
      topic,
      theme,
      searchTerms,
      scrapedCandidates: candidates.length,
      keptRelevant: relevant.length,
      aboveFloor: aboveFloor.length,
      clips,
    });
  } catch (err) {
    console.error("scrape-pool failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
