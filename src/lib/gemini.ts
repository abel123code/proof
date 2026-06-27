import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import { requireEnv } from "@/lib/env";
import type { ReferenceStructure } from "@/lib/types";

let cached: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (cached) return cached;
  cached = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
  return cached;
}

/** Model used for video structural analysis. Verify availability/latency before relying on it. */
export const GEMINI_VIDEO_MODEL = "gemini-2.5-flash";

const STRUCTURE_PROMPT = `You are a short-form video analyst. Analyze this TikTok-style "I built X" / project-introduction video and return its transferable STRUCTURE (not a virality claim).

Return ONLY a JSON object with this exact shape:
{
  "hook": "how the first ~3 seconds grab attention",
  "beats": ["ordered narrative beats of the video"],
  "pacing": "cut frequency, energy, and length notes",
  "onScreenText": [{ "atSeconds": 0, "text": "the on-screen caption text" }],
  "spoken": "summary of what was said (the voiceover / dialogue)",
  "visualTechnique": ["what was done on screen: shots, b-roll, screen recording, demo, etc."],
  "whyItWorks": "the transferable reason this structure is effective"
}

Be specific and concrete. Capture on-screen text timing as accurately as you can.`;

/**
 * Upload a local video file to the Gemini Files API and wait until it is ACTIVE
 * so it can be referenced in generateContent.
 */
async function uploadVideoAndWait(localPath: string, mimeType = "video/mp4") {
  const ai = getGemini();
  const uploaded = await ai.files.upload({
    file: localPath,
    config: { mimeType },
  });

  let file = uploaded;
  const name = file.name;
  if (!name) throw new Error("Gemini file upload returned no name.");

  // Poll until the file finishes processing.
  const deadline = Date.now() + 120_000;
  while (file.state === "PROCESSING") {
    if (Date.now() > deadline) throw new Error("Gemini file processing timed out.");
    await new Promise((r) => setTimeout(r, 2000));
    file = await ai.files.get({ name });
  }
  if (file.state === "FAILED") throw new Error("Gemini failed to process the video file.");
  return file;
}

/**
 * Analyze a local reference video file and return its structured breakdown.
 */
export async function analyzeVideoStructure(localPath: string): Promise<ReferenceStructure> {
  const ai = getGemini();
  const file = await uploadVideoAndWait(localPath);
  if (!file.uri || !file.mimeType) throw new Error("Gemini file is missing uri/mimeType.");

  const response = await ai.models.generateContent({
    model: GEMINI_VIDEO_MODEL,
    contents: createUserContent([
      createPartFromUri(file.uri, file.mimeType),
      STRUCTURE_PROMPT,
    ]),
    config: { responseMimeType: "application/json" },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response.");
  return JSON.parse(text) as ReferenceStructure;
}
