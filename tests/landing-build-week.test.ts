import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/page.tsx", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");

describe("Build Week landing page", () => {
  it("names the OpenAI production stack and removes the superseded sponsor pitch", () => {
    expect(source).toContain("OpenAI");
    expect(source).toContain("GPT-5.6");
    expect(source).toContain("Whisper");
    expect(source).toContain("HyperFrames");
    expect(source).toContain("Codex");
    expect(source).not.toMatch(/\bExa\b/);
    expect(source).not.toMatch(/\bZo\b/);
    expect(source).not.toContain("built in 12 hours");
    expect(source).not.toContain("/hero.png");
    expect(layout).toContain('metadataBase: new URL("https://tryproof.org")');
    expect(layout).not.toContain("proof-build2026.vercel.app");
  });

  it("does not publish stale sponsor decks or rejected demo output", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");

    expect(existsSync("proof-deck.html")).toBe(false);
    expect(existsSync("public/proof-deck.html")).toBe(false);
    expect(existsSync("public/good-builder-invisible-post.mp4")).toBe(false);
    expect(proxy).not.toContain("/proof-deck.html");
    expect(existsSync("public/x-banner.png")).toBe(false);
    expect(existsSync("src/app/opengraph-image.png")).toBe(false);
    expect(existsSync("src/app/twitter-image.png")).toBe(false);

    const socialCard = readFileSync("src/app/social-card.tsx", "utf8");
    expect(socialCard).toContain("tryproof.org");
    expect(socialCard).toContain("OpenAI GPT-5.6");
  });
});
