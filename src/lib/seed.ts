import { openaiJSON } from "@/lib/openai";

// Exa trends are verbose, headline-style sentences (e.g. "Content is becoming a
// dev workflow problem: builders are wiring posts to IDEs, commits, and
// milestones"). Those make terrible TikTok search queries. This distills a trend
// into a short THEME plus a handful of short, search-friendly SEED TERMS that
// people would actually type, so the scrape returns real, on-theme clips.
const SEED_SYSTEM =
  "You convert a verbose trending topic into short TikTok search queries that surface videos ABOUT THAT SPECIFIC TOPIC. " +
  "Given a TREND (a headline-style sentence) and optional CONTEXT, output a short THEME (2-4 words capturing the SPECIFIC subject, not the broad niche) and 4-6 SEARCH_TERMS. " +
  "Rules for SEARCH_TERMS: " +
  "1-4 words each, lowercase, no punctuation, no hashtags, no full sentences. " +
  "They must be phrases a real person types into TikTok search AND be specific to the trend's actual subject - use the concrete nouns/verbs/tools from the TREND, not generic community labels. " +
  "At most ONE broad fallback term is allowed; the rest must be topic-specific. " +
  "Example - TREND: 'Content is becoming a dev workflow problem: builders are wiring posts to IDEs, commits, and milestones'. " +
  "GOOD: theme 'automating dev content', searchTerms ['build in public automation','content automation','automate posting','coding in public','post from commits']. " +
  "BAD (too generic, do NOT do this): ['indie hacker','side project','dev tiktok','coding content']. " +
  'Return ONLY JSON: { "theme": string, "searchTerms": [string] }.';

export interface SeedTerms {
  theme: string;
  searchTerms: string[];
}

/** Distill a verbose trend into a short theme + search-friendly seed terms. */
export async function buildSeedTerms(input: {
  topic: string;
  context?: string;
}): Promise<SeedTerms> {
  try {
    const out = await openaiJSON<SeedTerms>({
      system: SEED_SYSTEM,
      user: JSON.stringify({ TREND: input.topic, CONTEXT: input.context ?? null }),
    });
    const searchTerms = (Array.isArray(out.searchTerms) ? out.searchTerms : [])
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, 6);
    const theme = (out.theme ?? "").trim();
    if (searchTerms.length > 0) {
      return { theme: theme || searchTerms[0], searchTerms };
    }
  } catch (e) {
    console.error("buildSeedTerms failed, falling back:", e);
  }
  // Fallback: take the first few words before any punctuation as a crude seed.
  const fallback = input.topic
    .split(/[:.,-]/)[0]
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
  return { theme: fallback, searchTerms: [fallback] };
}
