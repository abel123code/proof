import type {
  KeepSegment,
  RenderBrief,
  RenderBriefScene,
  VisualCue,
  VisualTemplate,
  Word,
} from "./types.js";

export interface SceneWindow {
  sceneIndex: number;
  startMs: number;
  endMs: number;
  scene: RenderBriefScene;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokens(value: string): string[] {
  return value.split(/\s+/).map(norm).filter(Boolean);
}

const TIMING_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "to", "of", "for", "with", "is", "are", "was", "were",
]);

function timingTokenMatches(spoken: string, target: string): boolean {
  if (spoken === target) return true;
  return Math.min(spoken.length, target.length) >= 4 &&
    (spoken.startsWith(target) || target.startsWith(spoken));
}

function cutTimeAt(originalMs: number, segments: KeepSegment[]): number {
  let cutMs = 0;
  for (const segment of segments) {
    if (originalMs >= segment.endMs) {
      cutMs += segment.endMs - segment.startMs;
      continue;
    }
    if (originalMs > segment.startMs) cutMs += originalMs - segment.startMs;
    break;
  }
  return cutMs;
}

export function buildSceneWindows(
  scenes: RenderBriefScene[],
  sourceDurationsMs: number[],
  segments: KeepSegment[],
  totalMs: number,
): SceneWindow[] {
  if (scenes.length === 0) return [];

  const durations = scenes.map((scene, index) => {
    const probed = sourceDurationsMs[index];
    if (Number.isFinite(probed) && probed > 0) return probed;
    return Math.max(1000, (scene.durationSeconds ?? 5) * 1000);
  });

  const windows: SceneWindow[] = [];
  let originalCursor = 0;
  for (let index = 0; index < scenes.length; index++) {
    const originalEnd = originalCursor + durations[index];
    const startMs = cutTimeAt(originalCursor, segments);
    const endMs = index === scenes.length - 1 ? totalMs : cutTimeAt(originalEnd, segments);
    if (endMs > startMs) {
      windows.push({ sceneIndex: index, startMs, endMs, scene: scenes[index] });
    }
    originalCursor = originalEnd;
  }
  return windows;
}

function chooseTemplate(scene: RenderBriefScene, index: number, total: number): VisualTemplate {
  const text = `${scene.label} ${scene.onScreenText} ${scene.brollCue}`.toLowerCase();
  if (index === 0 || /hook|opening|attention/.test(text)) return "hook";
  if (/\d|%|metric|number|users|hours|minutes|x\b/.test(text)) return "metric";
  if (/before|after|versus|vs\.?|compare|instead|problem.*solution/.test(text)) return "comparison";
  if (/step|process|flow|how it works|pipeline|sequence/.test(text)) return "steps";
  if (/quote|comment|people say|someone said|reaction/.test(text)) return "quote";
  if (index === total - 1 || /payoff|result|finally|ship|launch|outcome/.test(text)) return "payoff";
  return "keyword";
}

export function shortenHeadline(value: string, fallback: string): string {
  const source = value.trim() || fallback.trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length <= 6) return source;

  const stop = new Set([
    "a", "an", "the", "and", "or", "but", "that", "this", "to", "of", "for", "with",
    "is", "are", "was", "were", "be", "been",
  ]);
  const compact = words.filter((word, index) => index === 0 || !stop.has(norm(word))).slice(0, 6);
  return compact.join(" ").replace(/[,:;.!?]+$/, "");
}

export function buildVisualCues(windows: SceneWindow[], hook?: string): VisualCue[] {
  return windows.flatMap((window, index) => {
    const headline = shortenHeadline(
      window.scene.onScreenText,
      index === 0 ? hook || window.scene.label : window.scene.label,
    );
    if (!headline) return [];

    const available = window.endMs - window.startMs;
    const duration = Math.min(3200, Math.max(1600, available * 0.7));
    const startMs = window.startMs + Math.min(250, available * 0.08);
    return [{
      template: chooseTemplate(window.scene, index, windows.length),
      headline,
      startMs,
      endMs: Math.min(window.endMs, startMs + duration),
      sceneIndex: window.sceneIndex,
    }];
  });
}

export function anchorVisualCuesToTranscript(
  cues: VisualCue[],
  windows: SceneWindow[],
  words: Word[],
): VisualCue[] {
  const windowsByScene = new Map(windows.map((window) => [window.sceneIndex, window]));

  return cues.map((cue) => {
    const window = windowsByScene.get(cue.sceneIndex);
    if (!window) return cue;
    const sceneWords = words.filter(
      (word) => word.startMs >= window.startMs && word.startMs < window.endMs,
    );
    if (sceneWords.length === 0) return cue;

    const targetTokens = tokens(window.scene.onScreenText || cue.headline).filter(
      (token) => !TIMING_STOP_WORDS.has(token),
    );
    let anchorWord = sceneWords.find((word) => {
      const spoken = norm(word.text);
      return targetTokens.some((target) => timingTokenMatches(spoken, target));
    });

    if (!anchorWord && targetTokens.length > 0) {
      const scriptTokens = tokens(window.scene.spokenLine);
      const scriptIndex = scriptTokens.findIndex((token) => targetTokens.includes(token));
      if (scriptIndex >= 0 && scriptTokens.length > 0) {
        const ratio = scriptIndex / scriptTokens.length;
        anchorWord = sceneWords[Math.min(sceneWords.length - 1, Math.round(ratio * sceneWords.length))];
      }
    }

    anchorWord ??= sceneWords[Math.min(1, sceneWords.length - 1)];
    const duration = cue.endMs - cue.startMs;
    let startMs = Math.max(window.startMs, anchorWord.startMs - 160);
    let endMs = Math.min(window.endMs, startMs + duration);
    if (endMs - startMs < 1200) {
      startMs = Math.max(window.startMs, endMs - 1200);
    }
    return { ...cue, startMs, endMs };
  });
}

function emphasisTerms(brief: RenderBrief): Set<string> {
  const terms = new Set<string>();
  const sources = [brief.hook ?? "", ...brief.keywordFlags.map((flag) => flag.phrase)];
  for (const scene of brief.scenes ?? []) sources.push(scene.onScreenText, scene.label);
  for (const source of sources) {
    for (const token of tokens(source)) {
      if (token.length >= 4 || /\d/.test(token)) terms.add(token);
    }
  }
  return terms;
}

export function applyCaptionCopyAndEmphasis(words: Word[], brief: RenderBrief): Word[] {
  const scriptTokens = brief.script.split(/\s+/).filter(Boolean);
  const important = emphasisTerms(brief);
  let scriptCursor = 0;

  return words.map((word) => {
    const normalized = norm(word.text);
    let display = word.text;
    for (let index = scriptCursor; index < Math.min(scriptTokens.length, scriptCursor + 8); index++) {
      if (norm(scriptTokens[index]) !== normalized) continue;
      display = scriptTokens[index];
      scriptCursor = index + 1;
      break;
    }
    return { ...word, text: display, emphasis: important.has(normalized) };
  });
}
