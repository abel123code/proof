import { getOpenAI } from "../openai.js";
import { chatTuning, premiumRequestOptions } from "./model-params.js";
import { CAPTION_ZONE_TOP_Y } from "./caption-guard.js";
import type {
  CreativeDirection,
  RenderBrief,
  SceneBackgroundTreatment,
  SceneMode,
  SceneSpec,
} from "../types.js";

export const DEFAULT_PREMIUM_AUTHOR_MODEL = "gpt-5.6-sol";
const AUTHOR_MODEL = process.env.PREMIUM_AUTHOR_MODEL || DEFAULT_PREMIUM_AUTHOR_MODEL;
const AUTHOR_EFFORT = process.env.PREMIUM_AUTHOR_EFFORT;

export function authorSystemPrompt(
  durSec: number,
  mode: SceneMode = "overlay",
  backgroundTreatment: SceneBackgroundTreatment = "footage",
): string {
  const layout = mode === "full-frame" && backgroundTreatment === "black"
    ? `FULL-FRAME BLACKOUT MODE:
   - A solid black background is supplied by the compositor. Keep html, body, and #stage transparent.
   - The speaker is intentionally hidden because the visual carries the explanation.
   - Express one claim or relationship at a time. Comparisons, processes, mechanisms, state changes, timelines,
     and real proof artifacts may use the complete frame.
   - Preserve 35-50% negative space. Use no more than two font families and three hierarchy sizes.
   - Keep the bottom caption region visually quiet. Captions are composited after this scene.
   - Do not create a miniature website: no dashboards, no waveforms, no scanner frames, no status badges,
     no decorative metadata, no nested cards, and no permanent interface chrome.`
    : mode === "full-frame"
      ? `FULL-FRAME FOOTAGE MODE:
   - Keep html, body, and #stage transparent; the source footage remains visible behind the animation.
   - The speaker remains visible behind the graphic, but face overlap is allowed. Readability wins: never shrink,
     clip, abbreviate, or omit essential wording merely to keep the face clear.
   - Essential wording must use at least 56px type at 1080x1920. Prefer 64-96px for the primary phrase.
   - Express one claim or relationship at a time. Large comparisons, processes, mechanisms, state changes,
     timelines, and proof artifacts may dominate the frame without needlessly hiding the person.
   - Keep the bottom caption region visually quiet. Captions are composited after this scene.
   - Do not create a miniature website: no dashboards, no waveforms, no scanner frames, no status badges,
     no decorative metadata, no nested cards, and no permanent interface chrome.`
    : `OVERLAY MODE (over-the-head):
   - The speaker remains the primary visual. Add ONE visual authority that lives OVER THE HEAD.
   - PLACEMENT: keep all overlay content inside the TOP region, y=80..640, horizontally CENTERED, with
     at least 64px left/right margin. Do not corner-anchor it. The lower frame stays clean; keep
     everything above y=${CAPTION_ZONE_TOP_Y}, and y=${CAPTION_ZONE_TOP_Y}..1920 must remain empty.
   - The one authority may be a bold editorial headline (1-2 lines) OR one compact element — a small
     labeled diagram, toggle, metric, or short animation — kept inside that top band. Not both.
   - FONTS (critical — the render container only ships Liberation fonts): use ONLY
     font-family: Arial, "Liberation Sans", Helvetica, sans-serif  (or "Liberation Serif", Georgia,
     serif for a single editorial accent word). Get weight from font-weight:700 at large size.
     NEVER use Impact, Haettenschweiler, Anton, Oswald, Bebas, Arial Narrow, or any condensed /
     stencil / distressed display font; NEVER use font-stretch:condensed or expanded; keep
     letter-spacing no tighter than -0.02em. These distort into broken glyphs (e.g. "WHO" -> "VHO").
   - CASING: write headline text in its final literal case in the HTML (e.g. write "WHO MADE IT?"),
     do not rely on text-transform to uppercase mixed-case text.
   - Essential wording must use at least 56px type at 1080x1920; prefer 64-96px for the primary phrase.
     Use ONE emphasis color (brandColor) for the key word.
   - No opaque or translucent backplates, no pill/badge chips, no cards behind the text. If bright
     footage hurts legibility, use a soft text-shadow or a subtle top gradient scrim, never a panel.
   - Readability wins. Content may overlap the speaker's face when necessary; never shrink, clip,
     abbreviate, partially hide, or replace required wording to preserve the face.
   - MOTION: restrained. Fade with a short vertical settle, or replace one phrase/element in place; for
     a diagram, a purposeful build (draw / connect / count / toggle). No character-by-character, no
     typewriter, no ambient pulsing, no decorative scale loops.
   - No dashboards, no waveforms, no scanner frames, no status badges, no metadata chrome. If the idea
     genuinely needs a large multi-part explanation, it belongs full-frame, not over the head.`;

  return `You author a single HyperFrames HTML composition for a creator-native 1080x1920 vertical video.
Output ONE complete, self-contained HTML document. No markdown or commentary.

HARD CONTRACT:
1. Root element: <div id="stage" data-composition-id="{{ID}}" data-width="1080" data-height="1920" data-fps="30"
   style="position:relative;width:1080px;height:1920px;overflow:hidden">. Put all scene content inside it.
2. html, body, and #stage must remain transparent; never paint a full-frame opaque background.
3. Load GSAP only from <script src="./gsap.min.js"></script>. Do not use any external URL.
4. Build ONE paused GSAP timeline and register it exactly:
     const tl = gsap.timeline({ paused: true });
     window.__timelines = window.__timelines || {};
     window.__timelines["{{ID}}"] = tl;
5. The timeline duration must be exactly ${durSec.toFixed(2)} seconds. Append an empty tween if needed.
6. LOCAL ONLY. Assets may only use ./assets/<filename>. Do not use fetch, XMLHttpRequest, WebSocket,
   EventSource, dynamic import(), eval, new Function(), navigator.sendBeacon, or network URLs.
7. ${layout}
8. ONE VISUAL AUTHORITY. Replace elements instead of stacking them. One idea must clearly dominate each frame.
   Text may be the visual when it is a short editorial phrase, but never reproduce spokenContext as subtitles.
9. When assets are provided and the intent names one, embed the real ./assets/<filename> file and build around it.
10. Follow intent literally and follow creativeDirection across palette, typography, spacing, motif, and transitions.

DESIGN: creator-native, restrained, intentional, and on-brand. Animation must reveal, compare, count, connect,
change state, confirm, fail, or transition. Do not add ambient motion merely to keep the frame busy.
FONTS: the render container only ships the Liberation family, so use ONLY these installed stacks —
Arial, "Liberation Sans", Helvetica, sans-serif (weight via font-weight:700), or "Liberation Serif", Georgia,
serif for a serif accent. Never name Impact, Haettenschweiler, Anton, Oswald, Bebas, or Arial Narrow, never use
font-stretch:condensed/expanded, and never load web-font CDNs or <link> — these fall back to distorted glyphs.`;
}

function stripFences(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  return (match ? match[1] : trimmed).trim();
}

export interface AuthorMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function buildAuthorMessages(args: {
  system: string;
  payload: Record<string, unknown>;
  priorHtml?: string;
  priorIssues?: string[];
}): AuthorMessage[] {
  const { system, payload, priorHtml, priorIssues } = args;
  if (priorHtml && priorIssues?.length) {
    return [
      { role: "system", content: system },
      { role: "user", content: "You are editing a scene you already authored. Apply only the requested edits." },
      { role: "assistant", content: priorHtml },
      {
        role: "user",
        content:
          "Apply these edits and return the complete edited HTML. Preserve unaffected elements.\n" +
          `STAY TRUE TO THIS BRIEF: ${JSON.stringify(payload)}\n` +
          `EDITS TO APPLY: ${JSON.stringify(priorIssues)}`,
      },
    ];
  }
  return [
    { role: "system", content: system },
    { role: "user", content: `Author this scene:\n${JSON.stringify(payload)}` },
  ];
}

export async function authorScene(args: {
  spec: SceneSpec;
  brief: RenderBrief;
  creativeDirection: CreativeDirection;
  assetHints: string[];
  priorIssues?: string[];
  priorHtml?: string;
}): Promise<string> {
  const { spec, brief, creativeDirection, assetHints, priorIssues, priorHtml } = args;
  const payload = {
    id: spec.id,
    durationSec: spec.durMs / 1000,
    mode: spec.mode,
    backgroundTreatment: spec.backgroundTreatment ?? "footage",
    rationale: spec.rationale,
    intent: spec.intent,
    spokenContext: spec.captionText,
    motif: spec.motif,
    creativeDirection,
    brandColor: brief.assets?.brandColor || brief.accentColor || creativeDirection.emphasisColor,
    brandVoice: brief.assets?.brandVoice || null,
    assets: assetHints,
  };

  const system = authorSystemPrompt(
    spec.durMs / 1000,
    spec.mode,
    spec.backgroundTreatment ?? "footage",
  ).replace(/\{\{ID\}\}/g, spec.id);
  const client = getOpenAI();
  const response = await client.chat.completions.create({
    model: AUTHOR_MODEL,
    ...chatTuning(AUTHOR_MODEL, AUTHOR_EFFORT),
    messages: buildAuthorMessages({ system, payload, priorHtml, priorIssues }),
  }, premiumRequestOptions());

  const html = stripFences(response.choices[0]?.message?.content || "");
  if (!html.toLowerCase().includes("id=\"stage\"") && !html.toLowerCase().includes("id='stage'")) {
    throw new Error(`authorScene(${spec.id}): output missing #stage root`);
  }
  return html;
}
