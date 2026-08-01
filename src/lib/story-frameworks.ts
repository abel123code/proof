import type { HookArchetype, HookFormat, StoryLoop, StoryRole } from "@/lib/types";

export const STORY_ENGINE_VERSION = 1;

export const HOOK_FORMATS: HookFormat[] = [
  "future-shift",
  "contrarian-truth",
  "builder-secret",
  "proof-first",
  "visual-proof",
  "unexpected-connection",
];

export const STORY_ROLES: StoryRole[] = [
  "hook",
  "stakes",
  "question",
  "expectation",
  "reversal",
  "proof",
  "payoff",
  "rehook",
  "cta",
];

const LEGACY_HOOK_MAP: Record<HookArchetype, HookFormat> = {
  "hot-take": "contrarian-truth",
  "proof-drop": "proof-first",
  "action-start": "visual-proof",
  "trend-reference": "future-shift",
  "unanswerable-question": "unexpected-connection",
};

export function normalizeHookFormat(
  format: unknown,
  legacy: HookArchetype | undefined,
): HookFormat {
  return HOOK_FORMATS.includes(format as HookFormat)
    ? (format as HookFormat)
    : LEGACY_HOOK_MAP[legacy ?? "proof-drop"];
}

export function normalizeEvidenceIds(value: unknown, validIds?: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (id): id is string =>
          typeof id === "string" && id.trim().length > 0 && (!validIds?.size || validIds.has(id)),
      ),
    ),
  );
}

export function normalizeStoryLoops(value: unknown, validIds?: ReadonlySet<string>): StoryLoop[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((loop): loop is Partial<StoryLoop> => Boolean(loop && typeof loop === "object"))
    .map((loop) => ({
      stakes: typeof loop.stakes === "string" ? loop.stakes.trim() : "",
      openQuestion: typeof loop.openQuestion === "string" ? loop.openQuestion.trim() : "",
      expectedBelief: typeof loop.expectedBelief === "string" ? loop.expectedBelief.trim() : "",
      proofBackedReversal:
        typeof loop.proofBackedReversal === "string" ? loop.proofBackedReversal.trim() : "",
      evidenceIds: normalizeEvidenceIds(loop.evidenceIds, validIds),
      payoff: typeof loop.payoff === "string" ? loop.payoff.trim() : "",
      rehook: typeof loop.rehook === "string" && loop.rehook.trim() ? loop.rehook.trim() : null,
    }))
    .filter((loop) => loop.stakes || loop.openQuestion || loop.proofBackedReversal || loop.payoff);
}

export function isStoryRole(value: unknown): value is StoryRole {
  return STORY_ROLES.includes(value as StoryRole);
}
