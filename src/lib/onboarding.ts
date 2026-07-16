export const ONBOARDING_VERSION = 1;

export const ONBOARDING_STATES = ["not_started", "completed", "skipped"] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export function isOnboardingState(value: unknown): value is OnboardingState {
  return typeof value === "string" && ONBOARDING_STATES.includes(value as OnboardingState);
}

export function shouldAutoStartOnboarding(
  state: OnboardingState,
  version: number,
): boolean {
  return state === "not_started" || version < ONBOARDING_VERSION;
}
