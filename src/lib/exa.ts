import Exa from "exa-js";
import { requireEnv } from "@/lib/env";
import { CREATOR_PERSONA } from "@/lib/persona";
import type { ProjectUnderstanding, Trend, TrendResearch } from "@/lib/types";

let cached: Exa | null = null;

export function getExa(): Exa {
  if (cached) return cached;
  cached = new Exa(requireEnv("EXA_API_KEY"));
  return cached;
}

/**
 * Build the trend-first research query. This deliberately goes WIDE: it hunts for
 * big, mainstream AI / dev-tooling / tech-culture trends that already have lots of
 * short-form video and conversation RIGHT NOW (so the TikTok pool is rich and the
 * topic is relatable). The builder profile is only a light steer so the trends
 * stay in a lane this creator can credibly speak to - the deep tie to their own
 * work happens later at script time.
 */
export function buildTrendQuery(understanding: ProjectUnderstanding): string {
  const steering = [
    understanding.oneLiner && `What they build: ${understanding.oneLiner}`,
    understanding.stack?.length && `Their stack: ${understanding.stack.join(", ")}`,
    understanding.interesting && `Their standout work: ${understanding.interesting}`,
  ]
    .filter(Boolean)
    .join(". ");

  return `${CREATOR_PERSONA}

Find 4-6 BIG, currently-trending topics in AI, developer tooling, and tech culture that are being talked about a LOT this week / this month AND already have plenty of short-form video (TikTok / Reels / Shorts) about them. Think mainstream, recognizable waves a builder could ride for reach - for example: new model or product launches (e.g. Claude / Claude Code, GPT, Gemini), AI agents, "vibe coding", AI coding tools (Cursor, etc.), AI replacing/changing dev jobs, build-in-public culture, viral dev hot-takes. Prioritize real, recent discussion on X, Reddit, Hacker News, YouTube, and TikTok.

Go BROAD, not niche: pick topics with high public interest and lots of existing content, NOT hyper-specific internal pain points. The builder profile below is only a light steer so topics stay in their world (AI / software / building) - do NOT narrow the trends down to this exact project.

Steering context (the builder, NOT the search subject): ${steering}

For EACH trend, return:
- topic: the trending topic as a SHORT, punchy, recognizable phrase (3-7 words, the kind of thing someone would actually search on TikTok - e.g. "Claude Code", "AI coding agents", "vibe coding"). NOT a long abstract sentence.
- whyTrending: why it's blowing up right now
- whereDiscussed: where it's being discussed (e.g. "X", "TikTok", "Hacker News", "r/programming")
- sourceUrls: 1-3 real, recent URLs to the actual discussion/article
- suggestedAngle: one line on how THIS builder could ride the trend in a video using their own projects as proof

Only include trends backed by real, recent sources.`;
}

/** Agent outputSchema: structured trends with embedded, validated source URLs. */
export const TREND_SCHEMA = {
  type: "object",
  properties: {
    trends: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          whyTrending: { type: "string" },
          whereDiscussed: { type: "string" },
          sourceUrls: {
            type: "array",
            maxItems: 3,
            items: { type: "string", format: "uri" },
          },
          suggestedAngle: { type: "string" },
        },
        required: ["topic", "whyTrending", "whereDiscussed", "sourceUrls", "suggestedAngle"],
      },
    },
  },
  required: ["trends"],
} as const;

interface StructuredTrends {
  trends: Trend[];
}

/**
 * Run on-demand grounded trend research via the Exa Agent. Creates an agent run
 * with our structured schema, polls until it finishes, and maps the result into
 * a TrendResearch. Any trend missing source URLs is backfilled from the run's
 * grounding citations so the UI can always show "where this came from".
 */
export async function researchTrends(
  understanding: ProjectUnderstanding,
): Promise<TrendResearch> {
  const exa = getExa();

  const created = await exa.agent.runs.create({
    query: buildTrendQuery(understanding),
    outputSchema: TREND_SCHEMA as unknown as Record<string, unknown>,
    effort: "medium",
  });

  const runId = (created as { id: string }).id;
  const run = await exa.agent.runs.pollUntilFinished(runId, {
    pollInterval: 4000,
    timeoutMs: 240_000,
  });

  if (run.status !== "completed") {
    const detail = run.error?.message ?? run.stopReason ?? run.status;
    throw new Error(`Exa research did not complete: ${detail}`);
  }

  const structured = (run.output?.structured ?? null) as StructuredTrends | null;
  let trends = Array.isArray(structured?.trends) ? structured!.trends : [];

  // Backfill any missing source URLs from grounding citations.
  const groundedUrls = (run.output?.grounding ?? [])
    .flatMap((g) => g.citations ?? [])
    .map((c) => c.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);

  trends = trends.map((t) => {
    const urls = Array.isArray(t.sourceUrls) ? t.sourceUrls.filter(Boolean) : [];
    return {
      topic: t.topic ?? "",
      whyTrending: t.whyTrending ?? "",
      whereDiscussed: t.whereDiscussed ?? "",
      suggestedAngle: t.suggestedAngle ?? "",
      sourceUrls: urls.length > 0 ? urls : groundedUrls.slice(0, 3),
    };
  });

  if (trends.length === 0) {
    throw new Error("Exa research returned no trends - try again.");
  }

  return { trends, updatedAt: new Date().toISOString() };
}
