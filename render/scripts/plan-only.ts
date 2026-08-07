/**
 * Prints the scene plan without rendering, so you can pick which beat to probe.
 * Rendering a scene costs 2-3 minutes; choosing blind wastes most of them.
 *
 *   npx tsx scripts/plan-only.ts <props.json> <fixture.json>
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { planEdit } from "../src/premium/scenes.js";
import type { RenderBrief, Word } from "../src/types.js";

const [propsArg, fixtureArg] = process.argv.slice(2);
if (!propsArg || !fixtureArg) {
  console.error("usage: npx tsx scripts/plan-only.ts <props.json> <fixture.json>");
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY || !process.env.SUPABASE_URL) {
  try {
    const text = await readFile(join(import.meta.dirname, "..", ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL|OPENAI_API_KEY)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fall through */
  }
}

const props = JSON.parse(await readFile(propsArg, "utf8")) as { words: Word[]; durationMs: number };
const { brief } = JSON.parse(await readFile(fixtureArg, "utf8")) as { brief: RenderBrief };

const names = (brief.assets?.images ?? []).map((u) => (u.split("/").pop() ?? "").replace(/[^a-zA-Z0-9.]+/g, "-"));
const plan = await planEdit({ brief, words: props.words, durationMs: props.durationMs, assetHints: names });

console.log(`asset hints: ${names.join(", ") || "(none)"}\n`);
plan.scenes.forEach((s, i) => {
  const uses = names.filter((n) => s.intent.includes(n));
  console.log(`[${i}] ${s.id}  ${s.mode}  @${s.anchorMs}ms for ${s.durMs}ms`);
  console.log(`     uses assets: ${uses.length ? uses.join(", ") : "no"}`);
  console.log(`     ${s.intent.slice(0, 180)}\n`);
});
