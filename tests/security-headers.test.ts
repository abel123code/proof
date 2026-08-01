import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

/**
 * These headers came out of beta feedback: the Supabase session cookie is readable from JS, so the
 * only honest mitigation is to make XSS harder to land. Deleting the block would be silent, hence
 * this guard.
 */
describe("global security headers", () => {
  it("applies to every route, root and nested alike", async () => {
    const rules = await nextConfig.headers!();

    expect(rules).toHaveLength(1);
    // Next's own catch-all: ":path*" matches the empty segment, so "/" and "/studio/abc" both hit it.
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].has).toBeUndefined();
    expect(rules[0].missing).toBeUndefined();
  });

  it("emits all four headers with the exact values we rely on", async () => {
    const rules = await nextConfig.headers!();
    // Exact count first: fromEntries silently drops a duplicate key, so a conflicting header
    // emitted before the expected one would otherwise pass unnoticed.
    expect(rules[0].headers).toHaveLength(4);
    const headers = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));

    expect(headers).toEqual({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      // The teleprompter needs camera and mic; everything else stays off.
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
    });
  });
});

/**
 * Source-level, deliberately. Asserting the rendered <head> would need a real `next build` plus a
 * running server, and next/font is a build-time transform that does not run under vitest. The actual
 * regression risk here is somebody deleting the flag while tidying the font block, which this catches.
 */
describe("font preloading", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const globals = readFileSync("src/app/globals.css", "utf8");

  it("keeps mono off the preload path", () => {
    const monoBlock = layout.match(/const mono = Geist_Mono\(\{[\s\S]*?\}\);/)?.[0];
    expect(monoBlock).toBeDefined();
    expect(monoBlock).toContain("preload: false");
  });

  it("still preloads the faces that do paint first", () => {
    for (const face of ["const display = Fraunces({", "const sans = Hanken_Grotesk({"]) {
      const block = layout.slice(layout.indexOf(face)).match(/\{[\s\S]*?\}\);/)?.[0];
      expect(block).not.toContain("preload: false");
    }
  });

  it("keeps the mono CSS variable wired up despite the preload change", () => {
    expect(layout).toContain('variable: "--font-geist-mono"');
    expect(layout).toContain("mono.variable");
    expect(globals).toContain("--font-mono: var(--font-geist-mono)");
  });
});
