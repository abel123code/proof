import { describe, expect, it } from "vitest";
import { renderConfirmationDescription } from "@/lib/render-confirmation";

describe("render confirmation", () => {
  it("states the configured credit cost and warns that rendering takes time", () => {
    expect(renderConfirmationDescription(80)).toBe(
      "Your footage will be sent to the editor for 80 credits. Rendering can take a few minutes, and the credits are charged when the job starts.",
    );
  });
});
