import type { Word } from "./types.js";

// Multi-word sequences Whisper splits, merged into the correct technical term.
const PHRASES: { seq: string[]; text: string }[] = [
  { seq: ["next", "js"], text: "Next.js" },
  { seq: ["trigger", "dev"], text: "Trigger.dev" },
  { seq: ["data", "for", "seo"], text: "DataForSEO" },
  { seq: ["type", "script"], text: "TypeScript" },
  { seq: ["ai", "seo"], text: "AI SEO" },
  { seq: ["super", "base"], text: "Supabase" },
  { seq: ["vibe", "coded"], text: "vibe-coded" },
];

// Single-token spelling / capitalization fixes for common product + tech names.
const WORDS: Record<string, string> = {
  aiseo: "AI SEO",
  dataforseo: "DataForSEO",
  typescript: "TypeScript",
  nextjs: "Next.js",
  triggerdev: "Trigger.dev",
  gemini: "Gemini",
  cursor: "Cursor",
  claude: "Claude",
  supabase: "Supabase",
  postgres: "Postgres",
  postgresql: "Postgres",
  vercel: "Vercel",
  seo: "SEO",
  ai: "AI",
  api: "API",
  json: "JSON",
  ui: "UI",
};

const normt = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Correct technical terms in the transcript (Trigger.dev, Next.js, AI SEO ...) — keeps timing. */
export function cleanTerms(words: Word[]): Word[] {
  const out: Word[] = [];
  for (let i = 0; i < words.length; ) {
    let matched = false;
    for (const p of PHRASES) {
      if (i + p.seq.length <= words.length && p.seq.every((t, j) => normt(words[i + j].text) === t)) {
        out.push({ text: p.text, startMs: words[i].startMs, endMs: words[i + p.seq.length - 1].endMs });
        i += p.seq.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const w = words[i];
    out.push({ ...w, text: WORDS[normt(w.text)] ?? w.text });
    i++;
  }
  return out;
}
