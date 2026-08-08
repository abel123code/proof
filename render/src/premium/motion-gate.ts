/**
 * Deterministic frozen-scene gate. A measured 53s production render showed mean pixel delta under
 * 2/255 for seconds at a time between cuts: the graphic animates in, then the timeline pads itself
 * out to the required duration with an empty tween and nothing else moves. Root cause was the old
 * author prompt ("Append an empty tween if needed") combined with "do not add ambient motion" —
 * the model reasonably concludes: animate the entrance, then hold a still. This gate runs on the
 * authored HTML BEFORE rendering: if the timeline is dominated by an empty-object pad, or only ever
 * had one real beat, re-author with targeted feedback for free instead of paying for a render plus
 * a vision call to discover the frame never moved.
 */

export interface MotionCheck {
  ok: boolean;
  reason?: string;
  holdRatio: number;
}

// Matches `tl.to({}, { ... duration: N ... }` or `gsap.to({}, { ... })`, tolerant of whitespace
// and quoted numbers. Deliberately a single-level brace match (like assets-gate's path check) —
// a padding tween is authored as a flat `{ duration: N }`, not a nested config.
const EMPTY_TWEEN = /(?:tl|gsap)\.to\(\s*\{\s*\}\s*,\s*\{([^}]*)\}/g;
const DURATION_IN_CONFIG = /["']?duration["']?\s*:\s*["']?(-?[\d.]+)["']?/;

// Any tween whose target is NOT an empty object — a real, meaningful beat.
//
// `.from` and `.fromTo` are counted, not just `.to`. Counting only `.to` was a false-positive
// factory: a reveal is idiomatically authored as `.from(".row", { opacity: 0 })` (animate rows IN
// from an offset), so entire scenes that visibly animated were reported as "0 real tweens" and
// re-authored twice against a defect that did not exist. That burned the whole retry budget and
// starved the vision QA, whose real findings then shipped unfixed — a false alarm crowding out the
// true one is worse than no alarm.
const ANY_TWEEN = /(?:tl|gsap)\.(?:to|from|fromTo)\(\s*([^,]+?)\s*,\s*\{[^}]*\}/g;

/** longestEmptyHold >= half the scene, or fewer than two real tweens, is the same defect: a frame
 *  that stops developing partway through instead of using its full duration. */
export function checkSceneMotion(html: string, durationSec: number): MotionCheck {
  let longestEmptyHold = 0;
  for (const m of html.matchAll(EMPTY_TWEEN)) {
    const durMatch = m[1].match(DURATION_IN_CONFIG);
    const dur = durMatch ? Number(durMatch[1]) : 0;
    if (Number.isFinite(dur) && dur > longestEmptyHold) longestEmptyHold = dur;
  }

  let nonEmptyTweens = 0;
  for (const m of html.matchAll(ANY_TWEEN)) {
    if (!/^\{\s*\}$/.test(m[1].trim())) nonEmptyTweens++;
  }

  // Guard against a degenerate (zero or negative) duration: division would yield NaN/Infinity.
  // Any empty hold at all against a zero-length scene is 100% padding; no hold is 0%.
  const holdRatio = durationSec > 0 ? longestEmptyHold / durationSec : longestEmptyHold > 0 ? 1 : 0;

  if (holdRatio >= 0.5) {
    return {
      ok: false,
      holdRatio,
      reason:
        `MUST FIX: an empty tween holds the frame frozen for ${longestEmptyHold.toFixed(2)}s of the ` +
        `${durationSec.toFixed(2)}s scene (${Math.round(holdRatio * 100)}% of it). The timeline must reach ` +
        `its duration through real, meaningful motion, not an entrance followed by a still hold — develop ` +
        `the frame across its full length instead of padding the remainder.`,
    };
  }

  if (nonEmptyTweens < 2) {
    return {
      ok: false,
      holdRatio,
      reason:
        `MUST FIX: the timeline has only ${nonEmptyTweens} real tween${nonEmptyTweens === 1 ? "" : "s"} — a ` +
        `single entrance with nothing after it reads as a frozen still for the rest of the scene. Add at ` +
        `least one more beat that develops the frame after the entrance, landing in the second half of the ` +
        `duration.`,
    };
  }

  return { ok: true, holdRatio };
}
