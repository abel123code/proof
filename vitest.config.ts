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
  },
});
