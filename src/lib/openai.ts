import OpenAI from "openai";
import { optionalEnv, requireEnv } from "@/lib/env";

let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (cached) return cached;
  cached = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return cached;
}

/**
 * Model tiering (cost control). We only spend the premium model on the one step
 * where quality drives the outcome (angle generation + virality scoring). Every
 * mechanical step (proof extraction, brief drafting, classification) runs on the
 * cheap tier. Both are env-overridable so a wrong slug on an account is a
 * one-line fix, not a code change.
 */
export const OPENAI_TEXT_MODEL = optionalEnv("OPENAI_TEXT_MODEL") ?? "gpt-5.5";
export const OPENAI_MINI_MODEL = optionalEnv("OPENAI_MINI_MODEL") ?? "gpt-5.4-mini";
/** Model used for web-search-grounded research (Responses API). */
export const OPENAI_SEARCH_MODEL = optionalEnv("OPENAI_SEARCH_MODEL") ?? OPENAI_TEXT_MODEL;

/**
 * Helper that asks the model for a JSON object and parses it.
 * Uses response_format json_object so we get parseable output.
 * Defaults to the cheap tier - pass `model: OPENAI_TEXT_MODEL` for the steps
 * that actually need premium quality.
 */
export async function openaiJSON<T>(args: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  const client = getOpenAI();
  const completion = await client.chat.completions.create({
    model: args.model ?? OPENAI_MINI_MODEL,
    response_format: { type: "json_object" },
    max_completion_tokens: args.maxTokens,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response.");
  return parseJSONLoose<T>(content);
}

/**
 * Web-search-grounded JSON via the Responses API. Runs the `web_search` tool so
 * the model can cite real, current sources, then returns parsed JSON from the
 * final text. We parse defensively (stripping code fences / prose) rather than
 * relying on strict structured outputs, which are brittle alongside tool use.
 */
function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model);
}

export async function openaiWebSearchJSON<T>(args: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  const client = getOpenAI();
  const model = args.model ?? OPENAI_SEARCH_MODEL;
  const response = await client.responses.create({
    model,
    tools: [{ type: "web_search" }],
    // Reasoning models spend output budget on hidden reasoning + tool calls, so
    // give plenty of headroom (a small cap truncates the JSON) and keep reasoning
    // light for what is an extraction task, not a hard reasoning one.
    max_output_tokens: args.maxTokens ?? 9000,
    ...(isReasoningModel(model) ? { reasoning: { effort: "low" as const } } : {}),
    input: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  });
  const text = response.output_text;
  if (!text) {
    throw new Error(
      `OpenAI web-search returned no text (status: ${response.status ?? "unknown"}).`,
    );
  }
  return parseJSONLoose<T>(text);
}

/** Tolerant JSON extraction: handles ```json fences and leading/trailing prose. */
export function parseJSONLoose<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through to fence / brace extraction
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const start = candidate.search(/[[{]/);
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch {
      // fall through to the descriptive error below
    }
  }
  throw new Error(
    `Could not parse JSON from model output. Got: ${trimmed.slice(0, 200)}…`,
  );
}
