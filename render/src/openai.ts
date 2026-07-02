import OpenAI from "openai";
import { requireEnv } from "./env.js";

let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (cached) return cached;
  cached = new OpenAI({
    apiKey: requireEnv("OPENAI_API_KEY"),
    timeout: 180_000, // transcription of a few minutes of audio can take a while
    maxRetries: 4,
  });
  return cached;
}
