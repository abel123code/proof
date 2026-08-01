import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the app's pure logic. No network / DB / env required - anything
// that touches Supabase or OpenAI is lazily initialized, so these imports are safe.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The render/ package and scripts have their own concerns; keep unit scope tight.
    exclude: ["node_modules", "render", ".next"],
    // Vitest bills a file's cold module import to whichever test runs FIRST in it, and
    // the route/page suites pull in the whole db + supabase graph. Those files measure
    // 7-10s to import on a warm machine, so the 5s default failed the first test of a
    // file at random while the assertion itself took under a millisecond. Raised here
    // rather than sprinkling per-test timeouts, because the cost is import, not logic,
    // and a slower CI box would hit it far more often than this one did.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
