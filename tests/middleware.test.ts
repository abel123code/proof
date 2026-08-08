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

  it("treats the legal pages as public", () => {
    // A privacy policy you have to sign in to read is not a privacy policy. Both were behind the
    // auth wall on first deploy: the page returned 200, but the body was the login screen.
    expect(isPublic("/privacy")).toBe(true);
    expect(isPublic("/terms")).toBe(true);
  });

  it("gates the studio + api routes", () => {
    expect(isPublic("/connect")).toBe(false);
    expect(isPublic("/research")).toBe(false);
    expect(isPublic("/brief")).toBe(false);
    expect(isPublic("/admin")).toBe(false);
    expect(isPublic("/api/render")).toBe(false);
  });
});
