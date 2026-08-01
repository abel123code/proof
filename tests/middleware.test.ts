import { describe, expect, it } from "vitest";
import { isPublic } from "@/proxy";

describe("isPublic (route gating)", () => {
  it("treats the landing + auth routes as public", () => {
    expect(isPublic("/")).toBe(true);
    expect(isPublic("/login")).toBe(true);
    expect(isPublic("/pending")).toBe(true);
    expect(isPublic("/auth/callback")).toBe(true);
    expect(isPublic("/proof-deck.html")).toBe(false);
  });

  it("gates the studio + api routes", () => {
    expect(isPublic("/connect")).toBe(false);
    expect(isPublic("/research")).toBe(false);
    expect(isPublic("/brief")).toBe(false);
    expect(isPublic("/admin")).toBe(false);
    expect(isPublic("/api/render")).toBe(false);
  });
});
