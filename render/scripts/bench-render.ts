/**
 * Decompose one render job's wall clock from the worker's timestamped logs.
 *
 * Exists because "is this faster?" got answered by guesswork once already: overlapping the caption
 * overlay with scene authoring was called the big win, and measuring showed it is ~11% of the job
 * while scene authoring is ~65%. Numbers before claims.
 *
 * Usage:
 *   railway logs --service proof-render --json > worker.json
 *   npx tsx render/scripts/bench-render.ts worker.json <jobIdPrefix>
 */
import { readFileSync } from "node:fs";

const [file, job] = process.argv.slice(2);
if (!file || !job) {
  console.error("usage: bench-render.ts <worker.json> <jobIdPrefix>");
  process.exit(1);
}

interface Event {
  t: number;
  m: string;
}

const events: Event[] = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .flatMap((line) => {
    try {
      const o = JSON.parse(line) as { timestamp?: string; message?: string };
      return o.timestamp && typeof o.message === "string"
        ? [{ t: Date.parse(o.timestamp), m: o.message }]
        : [];
    } catch {
      return [];
    }
  })
  .sort((a, b) => a.t - b.t);

const first = (re: RegExp): number | null => events.find((e) => re.test(e.m))?.t ?? null;
const secs = (ms: number | null): string => (ms == null ? "    n/a" : `${(ms / 1000).toFixed(1)}s`.padStart(7));
const gap = (a: number | null, b: number | null): number | null => (a == null || b == null ? null : b - a);

const frameLines = events.filter((e) => /^(Rendered|Encoded) \d+\/\d+/.test(e.m));
const frameFirst = frameLines[0]?.t ?? null;
const frameLast = frameLines[frameLines.length - 1]?.t ?? null;
const overlayDone = first(/overlay\.mov/);
const planned = first(new RegExp(`${job}.*scenes planned`));
const shipped = first(new RegExp(`${job}.*scenes shipped`));
const done = first(new RegExp(`DONE ${job}`));

// The log buffer often starts mid-overlay, so extrapolate that stage from its observed frame rate
// rather than reporting a truncated window as though it were the whole thing.
const m = /^Rendered (\d+)\/(\d+)/.exec(frameLines[0]?.m ?? "");
const framesSeen = m ? Number(m[2]) - Number(m[1]) : 0;
const observed = gap(frameFirst, frameLast);
const overlay =
  m && observed != null && framesSeen > 0 ? (observed / framesSeen) * Number(m[2]) : observed;

console.log(`job ${job}`);
console.log(`  overlay render        ${secs(overlay)}${framesSeen ? "   (extrapolated from frame rate)" : ""}`);
console.log(`  composite + plan      ${secs(gap(overlayDone, planned))}`);
console.log(`  scene authoring + QA  ${secs(gap(planned, shipped))}`);
console.log(`  composite + upload    ${secs(gap(shipped, done))}`);
console.log(`  TOTAL                 ${secs((overlay ?? 0) + (gap(overlayDone, done) ?? 0))}`);

const mine = events.filter((e) => e.m.includes(job));
const count = (re: RegExp): number => mine.filter((e) => re.test(e.m)).length;

// Two different senses of "flagged" live in these logs and conflating them overstates quality.
// The worker's summary counts every scene carrying an unresolved note, including subjective ones
// it decided to ship. "shipping FLAGGED" is the harder case: a MUST FIX that survived every retry.
const summary = mine.find((e) => /scenes shipped/.test(e.m))?.m ?? "";
const summaryFlagged = /\((\d+) flagged\)/.exec(summary)?.[1] ?? "?";

console.log(`\n  ${summary.replace(/^\[premium [0-9a-f-]+\]\s*/, "").trim()}`);
console.log(
  `  re-authors ${count(/re-author/)}   re-edits ${count(/re-edit/)}   ` +
    `scenes with unresolved notes ${summaryFlagged}   shipped despite a MUST FIX ${count(/shipping FLAGGED/)}`,
);
console.log(`  invented-text rejections ${count(/invented interface text/)}`);
