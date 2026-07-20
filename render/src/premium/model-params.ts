/**
 * Per-model request quirks in one place. gpt-5.x / o-series reject a custom `temperature`
 * and instead take `reasoning_effort`. gpt-4o is the reverse.
 * We drop `temperature` entirely (the default is fine for both) and only add `reasoning_effort`
 * for models that accept it, so the same call site works across model tiers.
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[0-9])/i.test(model.trim());
}

export function normalizeEffort(raw: string | undefined): ReasoningEffort {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "none" ||
    v === "medium" ||
    v === "high"
    ? v
    : "low";
}

/** Spread into `client.chat.completions.create({...})`. Empty object for legacy models. */
export function chatTuning(
  model: string,
  effort: string | undefined,
): { reasoning_effort?: ReasoningEffort } {
  return isReasoningModel(model) ? { reasoning_effort: normalizeEffort(effort) } : {};
}
