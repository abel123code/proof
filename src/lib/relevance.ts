import { openaiJSON } from "@/lib/openai";

// The target is a narrow, narrative genre: a founder/builder telling the STORY of a
// software/tech product they built. The matching intelligence is the product, so this
// prompt - not hashtag luck - is what defines the pool.
const FOUNDER_STORY_SYSTEM =
  "You curate a reference pool for a tool that helps a founder turn the STORY of the software/tech product they built into a short promo video. " +
  "KEEP a clip ONLY if it is a person telling the first-person STORY of a software / app / website / SaaS / tech product THEY built or are building: " +
  "the origin or why, what it does, the build-in-public journey, progress updates, milestones, or lessons from shipping it. It must be a personal narrative about their OWN product. " +
  "REJECT everything else, including: coding tutorials and how-to guides; generic startup/SaaS/hustle advice or explainers (e.g. 'what is SaaS', 'best side hustles', 'how to build a SaaS in 30 min'); tech news or commentary about OTHER companies' products; listicles and tips; motivation/mindset; reactions; crafts, art, makeup, cooking, physical/handmade goods, fashion, fitness, pets. " +
  "When unsure, REJECT. " +
  'Return ONLY JSON: { "keep": [<indices to keep>] }.';

/**
 * Classify captions for the founder-story genre.
 * Returns the set of indices (into the input array) that should be KEPT.
 * Captions that are empty are never kept (cannot be judged).
 */
export async function classifyFounderStory(captions: string[]): Promise<Set<number>> {
  const candidates = captions
    .map((caption, i) => ({ i, caption: caption ?? "" }))
    .filter((c) => c.caption.trim().length > 0);
  if (candidates.length === 0) return new Set();

  const { keep } = await openaiJSON<{ keep: number[] }>({
    system: FOUNDER_STORY_SYSTEM,
    user: JSON.stringify(candidates),
  });
  return new Set(keep);
}

const TOPIC_RELEVANCE_SYSTEM =
  "You filter TikTok clips for relevance to a specific TOPIC. " +
  "You are given a TOPIC and a list of {i, caption} objects. " +
  "KEEP a clip ONLY if its caption is genuinely about the TOPIC - someone discussing, explaining, demoing, reacting to, or telling a story related to it. " +
  "REJECT clips that merely share a keyword but are about something unrelated, and reject off-topic noise (generic lifestyle, crafts, fashion, fitness, food). " +
  "When unsure, REJECT. " +
  'Return ONLY JSON: { "keep": [<indices to keep>] }.';

/**
 * Classify captions for relevance to a given topic.
 * Returns the set of indices (into the input array) that should be KEPT.
 */
export async function classifyTopicRelevant(
  captions: string[],
  topic: string,
): Promise<Set<number>> {
  const candidates = captions
    .map((caption, i) => ({ i, caption: caption ?? "" }))
    .filter((c) => c.caption.trim().length > 0);
  if (candidates.length === 0) return new Set();

  const { keep } = await openaiJSON<{ keep: number[] }>({
    system: TOPIC_RELEVANCE_SYSTEM,
    user: JSON.stringify({ TOPIC: topic, CLIPS: candidates }),
  });
  return new Set(keep);
}
