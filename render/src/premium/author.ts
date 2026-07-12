import { getOpenAI } from "../openai.js";
import type { RenderBrief, SceneSpec } from "../types.js";

const AUTHOR_MODEL = process.env.PREMIUM_AUTHOR_MODEL || "gpt-4o";

/**
 * The HyperFrames composition contract (verified against hyperframes@0.7.54 `render --help`
 * and the runtime docs). Baked into the system prompt so GPT authors renderable HTML.
 */
function systemPrompt(durSec: number): string {
  return `You author a single HyperFrames HTML composition: a bespoke motion-graphic scene that overlays on top
of talking-head footage in a 1080x1920 vertical video. Output ONE complete, self-contained HTML document. No
markdown, no commentary — just the HTML.

HARD CONTRACT (the renderer fails if you break these):
1. Root element: <div id="stage" data-composition-id="{{ID}}" data-width="1080" data-height="1920" data-fps="30"
   style="position:relative;width:1080px;height:1920px;overflow:hidden">. Put all scene content inside it.
2. TRANSPARENT background everywhere: html, body, and #stage must have NO opaque background (background:transparent).
   The footage shows through the alpha — never paint a full-bleed opaque rectangle over the whole frame.
3. Load GSAP: <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>.
4. Build ONE paused GSAP timeline and register it EXACTLY like this so the renderer can seek it:
     const tl = gsap.timeline({ paused: true });
     /* ...your animation... */
     window.__timelines = window.__timelines || {};
     window.__timelines["{{ID}}"] = tl;
5. The timeline's total duration MUST be exactly ${durSec.toFixed(2)} seconds. If your animation is shorter,
   append tl.to({}, { duration: <remaining> }) so it ends at exactly ${durSec.toFixed(2)}s.
6. Reference provided assets ONLY as ./assets/<filename>. Do not fetch any other external URLs (GSAP CDN aside).
7. Keep type large and legible on mobile (min ~40px). Leave the lower third and center clear-ish so it doesn't
   bury the speaker's face; anchor graphics to the top third or edges unless the intent says otherwise.

DESIGN: premium, intentional, on-brand. Honor the recurring motif. Animate with purpose (staggered reveals,
one hero move) — not everything at once. Use the brand color as the accent.`;
}

function stripFences(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  return (m ? m[1] : t).trim();
}

/**
 * Author (or re-author) one scene's HyperFrames composition. On a re-render, `priorIssues`
 * (from the vision-QA pass) are fed back so the model fixes concrete problems instead of
 * starting blind.
 */
export async function authorScene(args: {
  spec: SceneSpec;
  brief: RenderBrief;
  assetHints: string[];
  priorIssues?: string[];
}): Promise<string> {
  const { spec, brief, assetHints, priorIssues } = args;

  const payload = {
    id: spec.id,
    durationSec: spec.durMs / 1000,
    intent: spec.intent,
    spokenWords: spec.captionText,
    motif: spec.motif,
    brandColor: brief.assets?.brandColor || brief.accentColor || "#d9ff45",
    brandVoice: brief.assets?.brandVoice || null,
    assets: assetHints,
    fixThese:
      priorIssues && priorIssues.length
        ? priorIssues
        : undefined,
  };

  const system = systemPrompt(spec.durMs / 1000).replace(/\{\{ID\}\}/g, spec.id);
  const client = getOpenAI();
  const resp = await client.chat.completions.create({
    model: AUTHOR_MODEL,
    temperature: 0.6,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: priorIssues?.length
          ? `Re-author this scene, FIXING these issues found by visual review:\n${JSON.stringify(
              payload,
            )}`
          : `Author this scene:\n${JSON.stringify(payload)}`,
      },
    ],
  });

  const html = stripFences(resp.choices[0]?.message?.content || "");
  if (!html.toLowerCase().includes("id=\"stage\"") && !html.toLowerCase().includes("id='stage'")) {
    throw new Error(`authorScene(${spec.id}): output missing #stage root`);
  }
  return html;
}
