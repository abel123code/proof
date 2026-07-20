import { describe, expect, it } from "vitest";
import { resolveRenderMode } from "@/lib/render-mode";

describe("resolveRenderMode", () => {
  it("defaults the user render path to the premium generated mode", () => {
    expect(resolveRenderMode(undefined)).toBe("generated-experimental");
  });

  it("allows a server operator to select a supported fallback mode", () => {
    expect(resolveRenderMode("brief-driven")).toBe("brief-driven");
    expect(resolveRenderMode("classic")).toBe("classic");
    expect(resolveRenderMode("generated-experimental")).toBe("generated-experimental");
  });

  it("fails closed on a misspelled server configuration", () => {
    expect(() => resolveRenderMode("premium")).toThrow(/RENDER_EDIT_MODE/);
  });
});
