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
});
