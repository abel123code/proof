/**
 * Per-model request quirks in one place. gpt-5.x / o-series reject a custom `temperature`
 * and instead take `reasoning_effort`. gpt-4o is the reverse.
 * We drop `temperature` entirely (the default is fine for both) and only add `reasoning_effort`
 * for models that accept it, so the same call site works across model tiers.
 */
export type ReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
type SdkReasoningEffort = Exclude<ReasoningEffort, "max">;
export const DEFAULT_PREMIUM_OPENAI_TIMEOUT_MS = 90_000;

export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[0-9])/i.test(model.trim());
}

export function normalizeEffort(raw: string | undefined): ReasoningEffort {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "low";
  if (["none", "low", "medium", "high", "xhigh", "max"].includes(v)) {
    return v as ReasoningEffort;
  }
  throw new Error(`Invalid PREMIUM reasoning effort: ${raw}`);
}

/** Spread into `client.chat.completions.create({...})`. Empty object for legacy models. */
export function chatTuning(
  model: string,
  effort: string | undefined,
): { reasoning_effort?: SdkReasoningEffort } {
  // OpenAI SDK 6.45's Chat Completions type omits the API's `max` literal.
  // Keep the cast at this compatibility boundary; the serialized value is unchanged.
  return isReasoningModel(model)
    ? { reasoning_effort: normalizeEffort(effort) as SdkReasoningEffort }
    : {};
}

/** Bound adaptive render calls so a slow model request cannot hold the job indefinitely. */
export function premiumRequestOptions(rawTimeout: string | undefined = process.env.PREMIUM_OPENAI_TIMEOUT_MS) {
  const parsed = Number(rawTimeout);
  const timeout = Number.isFinite(parsed) && parsed >= 10_000 && parsed <= 300_000
    ? Math.round(parsed)
    : DEFAULT_PREMIUM_OPENAI_TIMEOUT_MS;
  return { timeout, maxRetries: 1 } as const;
}
