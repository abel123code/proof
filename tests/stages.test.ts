import { describe, expect, it } from "vitest";
import { STAGES, stageIndex } from "@/components/studio/stages";

describe("stageIndex", () => {
  it("maps each stage href to its order", () => {
    expect(stageIndex("/connect")).toBe(0);
    expect(stageIndex("/research")).toBe(1);
    expect(stageIndex("/brief")).toBe(2);
  });

  it("returns -1 for an unknown path", () => {
    expect(stageIndex("/settings")).toBe(-1);
  });

  it("keeps the pipeline in a stable order", () => {
    expect(STAGES.map((s) => s.href)).toEqual(["/connect", "/research", "/brief"]);
  });
});
