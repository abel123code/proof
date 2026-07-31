import { describe, expect, it } from "vitest";
import { shouldResumeSavedBrief } from "@/components/studio/brief-selection";

describe("shouldResumeSavedBrief", () => {
  it("resumes a saved brief when the user has not selected new creative input", () => {
    expect(shouldResumeSavedBrief(true, false)).toBe(true);
  });

  it("does not restore the old brief after the user selects a new angle", () => {
    expect(shouldResumeSavedBrief(true, true)).toBe(false);
  });

  it("does not attempt to resume when no saved brief exists", () => {
    expect(shouldResumeSavedBrief(false, false)).toBe(false);
  });
});
