import { describe, expect, it } from "vitest";
import { toRenderBrief } from "@/lib/render-brief";
import type { BriefScene } from "@/lib/types";

function scene(partial: Partial<BriefScene>): BriefScene {
  return {
    scene: 1,
    label: "",
    spokenLine: "",
    onScreenText: "",
    brollCue: "",
    ...partial,
  };
}

describe("toRenderBrief", () => {
  it("joins spoken lines into the script in order", () => {
    const out = toRenderBrief([
      scene({ scene: 1, spokenLine: "Line one" }),
      scene({ scene: 2, spokenLine: "Line two" }),
    ]);
    expect(out.script).toBe("Line one\nLine two");
  });

  it("skips empty spoken lines", () => {
    const out = toRenderBrief([
      scene({ spokenLine: "Only line" }),
      scene({ spokenLine: "   " }),
    ]);
    expect(out.script).toBe("Only line");
  });

  it("anchors on-screen text as a ratio overlay at the scene midpoint", () => {
    const out = toRenderBrief([
      scene({ scene: 1, spokenLine: "a", durationSeconds: 10 }),
      scene({ scene: 2, spokenLine: "b", durationSeconds: 10, onScreenText: "BOOM" }),
    ]);
    expect(out.overlays).toHaveLength(1);
    const overlay = out.overlays![0];
    expect(overlay.type).toBe("text-card");
    expect(overlay.content).toBe("BOOM");
    expect(overlay.anchor).toEqual({ kind: "ratio", at: 0.75 });
  });

  it("produces no overlays when there is no on-screen text", () => {
    const out = toRenderBrief([scene({ spokenLine: "a" })]);
    expect(out.overlays).toEqual([]);
  });

  it("clamps the overlay ratio to < 1", () => {
    const out = toRenderBrief([scene({ spokenLine: "a", durationSeconds: 5, onScreenText: "x" })]);
    // Single scene: midpoint = 2.5 / 5 = 0.5, well within bounds.
    expect(out.overlays![0].anchor).toEqual({ kind: "ratio", at: 0.5 });
  });
});
