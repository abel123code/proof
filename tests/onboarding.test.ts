import { describe, expect, it } from "vitest";
import {
  isOnboardingState,
  ONBOARDING_VERSION,
  shouldAutoStartOnboarding,
} from "@/lib/onboarding";

describe("onboarding state", () => {
  it("accepts only persisted onboarding states", () => {
    expect(isOnboardingState("not_started")).toBe(true);
    expect(isOnboardingState("completed")).toBe(true);
    expect(isOnboardingState("skipped")).toBe(true);
    expect(isOnboardingState("active")).toBe(false);
    expect(isOnboardingState(null)).toBe(false);
  });

  it("auto-starts for new users", () => {
    expect(shouldAutoStartOnboarding("not_started", ONBOARDING_VERSION)).toBe(true);
  });

  it("does not auto-start a current completed or skipped tour", () => {
    expect(shouldAutoStartOnboarding("completed", ONBOARDING_VERSION)).toBe(false);
    expect(shouldAutoStartOnboarding("skipped", ONBOARDING_VERSION)).toBe(false);
  });

  it("replays an older onboarding version", () => {
    expect(shouldAutoStartOnboarding("completed", ONBOARDING_VERSION - 1)).toBe(true);
    expect(shouldAutoStartOnboarding("skipped", ONBOARDING_VERSION - 1)).toBe(true);
  });
});
