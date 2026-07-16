export const ONBOARDING_EVENT = "proof:onboarding-action";

export type OnboardingAction =
  | "github-saved"
  | "repo-searched"
  | "repo-selected"
  | "repo-analyzed"
  | "repo-analysis-failed";

export function emitOnboardingAction(action: OnboardingAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OnboardingAction>(ONBOARDING_EVENT, { detail: action }));
}
