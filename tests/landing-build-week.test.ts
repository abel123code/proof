import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/page.tsx", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");
const globals = readFileSync("src/app/globals.css", "utf8");
const landingDemo = readFileSync("src/components/landing-demo.tsx", "utf8");
const reveal = readFileSync("src/components/reveal.tsx", "utf8");
const teleprompter = readFileSync("src/components/studio/teleprompter.tsx", "utf8");

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

  it("embeds one progressive teleprompter trial in the hero without a second onboarding card", () => {
    expect(source).toContain("<LandingDemo />");
    expect(source.match(/<LandingDemo/g)).toHaveLength(1);
    expect(source).not.toContain("LandingHeroTeleprompter");
    expect(source).toContain("lg:grid-cols-[0.92fr_1.08fr]");
    expect(source).not.toContain("md:grid-cols-[0.92fr_1.08fr]");
    expect(source).not.toContain("Proof render");
    expect(source).not.toContain("Sol QA passed");
    expect(source).not.toContain("One place for every deadline.");

    expect(landingDemo).toContain('from "@/components/studio/teleprompter"');
    expect(landingDemo).toContain('presentation="inline"');
    expect(landingDemo).toContain("Start the inline teleprompter");
    expect(landingDemo).toContain('<h2 className="sr-only">');
    expect(landingDemo).not.toContain("Just follow these steps");
    expect(teleprompter).toContain('presentation = "modal"');
    expect(teleprompter).toContain('presentation === "inline"');
    expect(teleprompter).toContain('inline ? "right-3 top-20 sm:top-3"');
    expect(existsSync("public/proof-teleprompter-loop.mp4")).toBe(false);
  });

  it("animates entrance + scroll-reveal without hiding content from no-JS or reduced-motion users", () => {
    // Hero fades up on load; sections reveal on scroll via the client <Reveal> wrapper.
    expect(source).toContain('from "@/components/reveal"');
    expect(source).toContain('className="enter');
    expect(source.match(/<Reveal/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(reveal).toContain('"use client"');
    expect(reveal).toContain("IntersectionObserver");

    // FOUC / no-JS safety: reveals are only hidden once JS arms `.reveal-ready` before paint,
    // so server-rendered and script-disabled views show the content instead of a blank section.
    expect(globals).toContain(".reveal-ready .reveal");
    expect(globals).not.toMatch(/^\.reveal\s*\{[^}]*opacity:\s*0/m);
    expect(layout).toContain("reveal-ready");
    expect(layout).toContain("suppressHydrationWarning");

    // Reduced-motion users keep all content (no lingering opacity:0).
    expect(globals).toContain("prefers-reduced-motion");
    expect(globals).toMatch(/prefers-reduced-motion[\s\S]*\.reveal[\s\S]*opacity:\s*1\s*!important/);
  });
});
