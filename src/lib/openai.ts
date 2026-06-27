import OpenAI from "openai";
import { requireEnv } from "@/lib/env";

let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (cached) return cached;
  cached = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return cached;
}

/** Default text model for the intelligence steps. */
export const OPENAI_TEXT_MODEL = "gpt-5.5";

/**
 * Helper that asks the model for a JSON object and parses it.
 * Uses response_format json_object so we get parseable output.
 */
export async function openaiJSON<T>(args: {
  system: string;
  user: string;
  model?: string;
}): Promise<T> {
  const client = getOpenAI();
  const completion = await client.chat.completions.create({
    model: args.model ?? OPENAI_TEXT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response.");
  return JSON.parse(content) as T;
}
