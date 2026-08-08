import { describe, expect, it } from "vitest";
import { renderConfirmationDescription } from "@/lib/render-confirmation";

describe("render confirmation", () => {
  it("states the configured credit cost and how long rendering actually takes", () => {
    // "A few minutes" against a measured 8 read as "it has hung", and people re-ran the job and
    // paid twice. The number is named for that reason, so keep it in the string.
    expect(renderConfirmationDescription(80)).toBe(
      "Your footage will be sent to the editor for 80 credits. This usually takes about 8 minutes, and the credits are charged when the job starts.",
    );
  });
});
