import { getOpenAI } from "./openai.js";
import { buildVisualCues, shortenHeadline, type SceneWindow } from "./brief-editor.js";
import type { RenderBrief, VisualCue, VisualTemplate } from "./types.js";

const MODEL = process.env.BRIEF_VISUAL_MODEL || "gpt-4o";
const ENABLED = (process.env.BRIEF_VISUAL_PLANNER ?? "true").toLowerCase() !== "false";
const TEMPLATES = new Set<VisualTemplate>([
  "hook",
  "keyword",
  "metric",
  "comparison",
  "steps",
  "quote",
  "payoff",
]);

interface PlannedVisual {
  sceneIndex?: number;
  template?: VisualTemplate;
  headline?: string;
}

export async function planBriefVisuals(args: {
  brief: RenderBrief;
  windows: SceneWindow[];
  log?: (message: string) => void;
}): Promise<VisualCue[]> {
  const fallback = buildVisualCues(args.windows, args.brief.hook);
  if (!ENABLED || args.windows.length === 0) return fallback;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: MODEL,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You plan restrained motion graphics for a vertical creator reel. Choose exactly one reusable template per scene. " +
            "Allowed templates: hook, keyword, metric, comparison, steps, quote, payoff. Headlines must preserve the supplied " +
            "meaning, contain 2-6 words, and must not repeat the full spoken sentence. Return JSON {visuals:[{sceneIndex,template,headline}]}. " +
            "Use the scene label, on-screen text and B-roll cue; do not invent claims or numbers.",
        },
        {
          role: "user",
          content: JSON.stringify({
            hook: args.brief.hook,
            targetFeeling: args.brief.targetFeeling,
            scenes: args.windows.map((window) => ({
              sceneIndex: window.sceneIndex,
              label: window.scene.label,
              spokenLine: window.scene.spokenLine,
              onScreenText: window.scene.onScreenText,
              brollCue: window.scene.brollCue,
            })),
          }),
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return fallback;
    const parsed = JSON.parse(content) as { visuals?: PlannedVisual[] };
    const byScene = new Map(
      (parsed.visuals ?? [])
        .filter(
          (visual): visual is Required<PlannedVisual> =>
            Number.isInteger(visual.sceneIndex) &&
            typeof visual.template === "string" &&
            TEMPLATES.has(visual.template) &&
            typeof visual.headline === "string" &&
            visual.headline.trim().length > 0,
        )
        .map((visual) => [visual.sceneIndex, visual]),
    );

    return fallback.map((cue) => {
      const planned = byScene.get(cue.sceneIndex);
      if (!planned) return cue;
      return {
        ...cue,
        template: planned.template,
        headline: shortenHeadline(planned.headline, cue.headline),
      };
    });
  } catch (error) {
    args.log?.(`brief visual planner fell back: ${(error as Error).message}`);
    return fallback;
  }
}

