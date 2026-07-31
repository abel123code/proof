import { describe, expect, it } from "vitest";
import { normalizeAngle } from "@/lib/research";
import type { Angle } from "@/lib/types";

function rawAngle(partial: Partial<Angle>): Angle {
  return { ...({} as Angle), ...partial };
}

describe("normalizeAngle", () => {
  it("recomputes total from the weighted sub-scores", () => {
    const out = normalizeAngle(
      rawAngle({
        title: "T",
        score: {
          hook: 100,
          shareability: 100,
          relevance: 100,
          emotion: 100,
          saveability: 100,
          trendFit: 100,
          total: 0,
        },
      }),
      0,
      [],
    );
    // Weights sum to 1.0, so all-100 sub-scores => total 100.
    expect(out.score.total).toBe(100);
  });

  it("weights hook, shareability and relevance most heavily", () => {
    const hookHeavy = normalizeAngle(
      rawAngle({ score: { hook: 100 } as Angle["score"] }),
      0,
      [],
    );
    const trendHeavy = normalizeAngle(
      rawAngle({ score: { trendFit: 100 } as Angle["score"] }),
      0,
      [],
    );
    // hook weight (0.26) > trendFit weight (0.08)
    expect(hookHeavy.score.total).toBeGreaterThan(trendHeavy.score.total);
  });

  it("keeps credibility ahead of surprise in the final rank", () => {
    const credible = normalizeAngle(
      rawAngle({ score: { credibility: 100 } as Angle["score"] }),
      0,
      [],
    );
    const shocking = normalizeAngle(
      rawAngle({ score: { surprise: 100 } as Angle["score"] }),
      0,
      [],
    );
    expect(credible.score.total).toBeGreaterThan(shocking.score.total);
  });

  it("clamps out-of-range and non-numeric sub-scores", () => {
    const out = normalizeAngle(
      rawAngle({ score: { hook: 999, emotion: -5 } as Angle["score"] }),
      0,
      [],
    );
    expect(out.score.hook).toBe(100);
    expect(out.score.emotion).toBe(0);
  });

  it("assigns a stable id and dedupes sources", () => {
    const out = normalizeAngle(rawAngle({ title: "X" }), 2, ["a", "a", "b"]);
    expect(out.id).toBe("angle-3");
    expect(out.sources).toEqual(["a", "b"]);
  });

  it("falls back to the first hook option when hook is missing", () => {
    const out = normalizeAngle(rawAngle({ hookOptions: ["first", "second"] }), 0, []);
    expect(out.hook).toBe("first");
  });

  it("normalizes legacy hook archetypes into Proof hook formats", () => {
    const out = normalizeAngle(rawAngle({ hookArchetype: "hot-take" }), 0, []);
    expect(out.hookFormat).toBe("contrarian-truth");
  });

  it("preserves evidence-backed story loops and removes unknown evidence ids", () => {
    const out = normalizeAngle(
      rawAngle({
        evidenceIds: ["receipt:0", "unknown:9"],
        storyLoops: [
          {
            stakes: "Founders ship products nobody notices.",
            openQuestion: "Why does good work still disappear?",
            expectedBelief: "The product needs more features.",
            proofBackedReversal: "The missing part is communicating the proof.",
            evidenceIds: ["receipt:0", "unknown:9"],
            payoff: "Turn the repository into a product video.",
            rehook: null,
          },
        ],
      }),
      0,
      [],
      new Set(["receipt:0"]),
    );
    expect(out.evidenceIds).toEqual(["receipt:0"]);
    expect(out.storyLoops[0].evidenceIds).toEqual(["receipt:0"]);
  });

  it("caps low-credibility angles below the recommended tier", () => {
    const out = normalizeAngle(
      rawAngle({
        score: {
          hook: 100,
          emotion: 100,
          shareability: 100,
          saveability: 100,
          trendFit: 100,
          relevance: 100,
          curiosity: 100,
          surprise: 100,
          loopStrength: 100,
          credibility: 30,
          total: 100,
        },
      }),
      0,
      [],
    );
    expect(out.score.total).toBeLessThanOrEqual(69);
  });

  it("penalizes numeric claims that are absent from the cited evidence", () => {
    const out = normalizeAngle(
      rawAngle({
        hook: "This increased launches by 300%.",
        evidenceIds: ["receipt:0"],
        score: {
          hook: 100,
          emotion: 80,
          shareability: 90,
          saveability: 80,
          trendFit: 80,
          relevance: 100,
          curiosity: 90,
          surprise: 90,
          loopStrength: 90,
          credibility: 100,
          total: 100,
        },
      }),
      0,
      [],
      new Set(["receipt:0"]),
      new Map([["receipt:0", "Founders can turn repository proof into a video."]]),
    );
    expect(out.score.credibility).toBeLessThanOrEqual(30);
    expect(out.score.total).toBeLessThanOrEqual(69);
  });
});
