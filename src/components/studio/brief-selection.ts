export const BRIEF_INPUT_PENDING_KEY = "proof.briefInputPending";

export function shouldResumeSavedBrief(
  hasSavedBrief: boolean,
  hasPendingCreativeInput: boolean,
): boolean {
  return hasSavedBrief && !hasPendingCreativeInput;
}
