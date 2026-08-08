import { getOpenAI, OPENAI_MINI_MODEL } from "@/lib/openai";
import { normalizeUiRecord, type UiRecord } from "@/lib/ui-record";

export interface ImageReading {
  /** One factual line about what the image shows, for the render planner. */
  caption: string;
  /** The verbatim on-screen text, or null when there is none or it could not be read. */
  record: UiRecord | null;
}

/**
 * Read an image once: a caption for the planner, and its verbatim text for the scene author.
 *
 * Both come from a single call because the expensive part is looking at the image, not answering
 * about it.
 *
 * `detail: "high"` is load-bearing. At low detail the image is downsampled until 14px interface
 * text is unreadable - plenty to say "a deadline list", not enough to say "10.016". The record
 * exists precisely for that small text, and a confident misreading of a course code is worse than
 * no record at all, so it is worth the tokens.
 *
 * Deliberately descriptive rather than evaluative: the planner needs "do I have a picture of X"
 * and "where is the interesting part", never "is this a nice screenshot".
 */
export async function describeImageUrl(url: string): Promise<ImageReading> {
  const client = getOpenAI();
  const response = await client.responses.create({
    model: OPENAI_MINI_MODEL,
    max_output_tokens: 2000,
    input: [
      {
        role: "system",
        content:
          "You read one screenshot or logo and return JSON only, with no prose and no code fences.\n" +
          '{"caption": string, "items": [{"text": string, "region": string, "legible": boolean}]}\n\n' +
          "caption: ONE sentence under 200 characters. Name the product, page or app if it is " +
          "identifiable from the image, say what is on screen, and end by naming where the " +
          "important content sits (for example 'panel occupies the right half', 'content is " +
          "centred', 'logo only'). State only what is visible. Never guess at a product you cannot " +
          "see, never speculate about purpose, and never comment on quality.\n\n" +
          "items: every piece of text visible on screen, copied EXACTLY as it appears - same " +
          "spelling, casing, punctuation, digits and spacing. Do not paraphrase, expand, correct, " +
          "complete or translate anything. region is a coarse position such as header, sidebar, " +
          "list, row, footer or button. Set legible true ONLY when you can read the characters " +
          "with certainty; when text is small, blurred or cut off, still include it but set " +
          "legible false. Marking something illegible is always better than guessing a digit. " +
          "For a logo or a photograph with no interface text, return an empty items array.",
      },
      { role: "user", content: [{ type: "input_image", image_url: url, detail: "high" }] },
    ],
  });

  const text = response.output_text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A non-JSON reply must not break an upload. The image stays usable; the planner reads a
    // missing caption as "unknown" and the author falls back to placing rather than rebuilding it.
    return { caption: "", record: null };
  }

  const rawCaption = (parsed as { caption?: unknown } | null)?.caption;
  return {
    caption: typeof rawCaption === "string" ? rawCaption : "",
    record: normalizeUiRecord(parsed),
  };
}
