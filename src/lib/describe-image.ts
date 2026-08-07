import { getOpenAI, OPENAI_MINI_MODEL } from "@/lib/openai";

/**
 * One factual line about what an image shows, for the render planner.
 *
 * Deliberately descriptive rather than evaluative: the planner needs to answer "do I have a
 * picture of X" and "where is the interesting part", not "is this a nice screenshot". It runs on
 * the mini tier because naming what is visibly in frame is a reading task, not a reasoning one.
 */
export async function describeImageUrl(url: string): Promise<string> {
  const client = getOpenAI();
  const response = await client.responses.create({
    model: OPENAI_MINI_MODEL,
    max_output_tokens: 300,
    input: [
      {
        role: "system",
        content:
          "Describe what a screenshot or logo shows, in ONE sentence under 200 characters. " +
          "Name the product, page or app if it is identifiable from the image, say what is on " +
          "screen, and end by naming where the important content sits (for example: 'panel " +
          "occupies the right half', 'content is centred', 'logo only'). " +
          "State only what is visible. Never guess at a product you cannot see, never speculate " +
          "about purpose, and never comment on quality.",
      },
      {
        role: "user",
        content: [{ type: "input_image", image_url: url, detail: "low" }],
      },
    ],
  });
  return response.output_text ?? "";
}
