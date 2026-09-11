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

  it("treats the social card images as public", () => {
    // Same failure as the legal pages, one layer down. Every social crawler
    // (Twitter, LinkedIn, Slack, Discord, iMessage) fetches these to build the
    // preview card. Gated, they answer 307 -> /login and the crawler gets 13KB
    // of login HTML where a PNG should be, so every shared link renders with no
    // image. Next's matcher only exempts paths with a file extension, and these
    // generated routes have none.
    expect(isPublic("/opengraph-image")).toBe(true);
    expect(isPublic("/twitter-image")).toBe(true);
  });

  it("gates the studio + api routes", () => {
    expect(isPublic("/connect")).toBe(false);
    expect(isPublic("/research")).toBe(false);
    expect(isPublic("/brief")).toBe(false);
    expect(isPublic("/admin")).toBe(false);
    expect(isPublic("/api/render")).toBe(false);
  });

  it("matches whole segments, so a public prefix cannot open a private route", () => {
    // The old check was a bare startsWith, which made anything merely BEGINNING
    // with a public prefix public too.
    expect(isPublic("/loginsomething")).toBe(false);
    expect(isPublic("/privacy-internal")).toBe(false);
    expect(isPublic("/terms-admin")).toBe(false);
    expect(isPublic("/opengraph-image-secret")).toBe(false);
    // Real nested children of a public prefix still pass.
    expect(isPublic("/auth/callback")).toBe(true);
  });
});
