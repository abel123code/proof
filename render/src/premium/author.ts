import { getOpenAI } from "../openai.js";
import { chatTuning, premiumRequestOptions } from "./model-params.js";
import type { RenderBrief, SceneSpec } from "../types.js";

export const DEFAULT_PREMIUM_AUTHOR_MODEL = "gpt-5.6-sol";
const AUTHOR_MODEL = process.env.PREMIUM_AUTHOR_MODEL || DEFAULT_PREMIUM_AUTHOR_MODEL;
const AUTHOR_EFFORT = process.env.PREMIUM_AUTHOR_EFFORT; // default "low" via chatTuning

/**
 * The HyperFrames composition contract (verified against hyperframes@0.7.54 `render --help`
 * and the runtime docs). Baked into the system prompt so GPT authors renderable HTML.
 */
export function authorSystemPrompt(durSec: number): string {
  return `You author a single HyperFrames HTML composition: a bespoke motion-graphic scene that overlays on top
of talking-head footage in a 1080x1920 vertical video. Output ONE complete, self-contained HTML document. No
markdown, no commentary — just the HTML.

HARD CONTRACT (the renderer fails if you break these):
1. Root element: <div id="stage" data-composition-id="{{ID}}" data-width="1080" data-height="1920" data-fps="30"
   style="position:relative;width:1080px;height:1920px;overflow:hidden">. Put all scene content inside it.
2. TRANSPARENT background everywhere: html, body, and #stage must have NO opaque background (background:transparent).
   The footage shows through the alpha — never paint a full-bleed opaque rectangle over the whole frame.
3. Load GSAP from the LOCAL file that is already in the scene folder: <script src="./gsap.min.js"></script>.
   Do NOT use a CDN or any http(s):// URL.
4. Build ONE paused GSAP timeline and register it EXACTLY like this so the renderer can seek it:
     const tl = gsap.timeline({ paused: true });
     /* ...your animation... */
     window.__timelines = window.__timelines || {};
     window.__timelines["{{ID}}"] = tl;
5. The timeline's total duration MUST be exactly ${durSec.toFixed(2)} seconds. If your animation is shorter,
   append tl.to({}, { duration: <remaining> }) so it ends at exactly ${durSec.toFixed(2)}s.
6. LOCAL ONLY. Reference provided assets solely as ./assets/<filename>, and GSAP as ./gsap.min.js. Do NOT
   reference ANY external URL (no http/https/ws/ftp, no protocol-relative //). Inline small graphics as
   data: URIs if needed. Do NOT use fetch, XMLHttpRequest, WebSocket, EventSource, dynamic import(), eval,
   new Function(), or navigator.sendBeacon. The scene renders with no network.
7. SPEAKER-SAFE LAYOUT. The speaker moves: keep x=160..920, y=180..1250 completely empty at every point,
   including entrance and exit motion. Keep the burned-in caption band y=1450..1920 empty. Safe placement is
   the header y=48..160, far gutters x=48..150 or x=930..1032, and lower band y=1260..1420. Keep every child
   inside its safe parent; a chip flying through the protected zone or touching hair will be rejected. There is
   no empty placeholder at any sampled frame: populate a card before revealing it and hide the whole card on
   exit. On repair, move every offender fully into a safe band. Keep type at least 40px and never clip a wordmark.
8. BUILD A VISUAL, NOT A CAPTION. A bare headline/label on a background — a text card — is the #1
   failure mode and will be REJECTED. Every scene must SHOW something concrete: the product screenshot,
   the logos, a recreated UI element, a chart/number that animates, a diagram. Text is a label ON the
   visual, never the whole scene. You are NOT a subtitle track — the spoken words ("spokenContext") are
   already captioned along the bottom, so never transcribe speech or reproduce the spoken sentence.
9. FEATURE THE ASSETS. When assets are provided (see "assets"), the scene MUST be built AROUND them:
   embed the actual image with <img src="./assets/<filename>" style="..."> (a screenshot in a device/
   browser frame, logos as real tiles, a UI cropped and called out). Do NOT describe an asset in text
   when you can show it. Only fall back to a pure-CSS visual when NO asset fits the beat.
10. Follow "intent" literally — it names the exact visual to build and which asset(s) to feature. The
    short on-screen headline (if any) comes from the intent; everything else is motion + imagery.

DESIGN: premium, intentional, on-brand. Honor the recurring motif. Animate with purpose (staggered reveals,
one hero move) — not everything at once. Use the brand color as the accent. Use a system/web-safe font stack
(e.g. -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif) — no web-font CDNs or <link>.`;
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
    // Context only — the beat's spoken words (already captioned on-screen). MUST NOT be displayed verbatim.
    spokenContext: spec.captionText,
    motif: spec.motif,
    brandColor: brief.assets?.brandColor || brief.accentColor || "#d9ff45",
    brandVoice: brief.assets?.brandVoice || null,
    assets: assetHints,
    fixThese:
      priorIssues && priorIssues.length
        ? priorIssues
        : undefined,
  };

  const system = authorSystemPrompt(spec.durMs / 1000).replace(/\{\{ID\}\}/g, spec.id);
  const client = getOpenAI();
  const resp = await client.chat.completions.create({
    model: AUTHOR_MODEL,
    ...chatTuning(AUTHOR_MODEL, AUTHOR_EFFORT),
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
  }, premiumRequestOptions());

  const html = stripFences(resp.choices[0]?.message?.content || "");
  if (!html.toLowerCase().includes("id=\"stage\"") && !html.toLowerCase().includes("id='stage'")) {
    throw new Error(`authorScene(${spec.id}): output missing #stage root`);
  }
  return html;
}
