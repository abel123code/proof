import { describe, expect, it } from "vitest";
import { normalizeBriefScenes } from "@/lib/content-brief";

describe("normalizeBriefScenes", () => {
  it("preserves valid narrative roles and evidence references", () => {
    const scenes = normalizeBriefScenes([
      {
        scene: 1,
        label: "The reversal",
        spokenLine: "The feature was not the real problem.",
        onScreenText: "The headfake",
        brollCue: "Show the repository, then the finished video.",
        durationSeconds: 6,
        storyRole: "reversal",
        storyLoop: 1,
        evidenceIds: ["receipt:0"],
      },
    ]);

    expect(scenes[0]).toMatchObject({
      storyRole: "reversal",
      storyLoop: 1,
      evidenceIds: ["receipt:0"],
    });
  });

  it("drops invalid narrative metadata without dropping the scene", () => {
    const scenes = normalizeBriefScenes([
      {
        scene: 1,
        label: "Hook",
        spokenLine: "You built the thing. Nobody saw it.",
        onScreenText: "Nobody saw it",
        brollCue: "Open on an empty analytics graph.",
        storyRole: "made-up-role",
        storyLoop: -1,
        evidenceIds: ["", "receipt:0"],
      },
    ]);

    expect(scenes[0].storyRole).toBeUndefined();
    expect(scenes[0].storyLoop).toBeUndefined();
    expect(scenes[0].evidenceIds).toEqual(["receipt:0"]);
  });

  it("repairs control characters in model-authored scene text", () => {
    const scenes = normalizeBriefScenes([
      {
        scene: 1,
        label: "Hook",
        spokenLine: "Repository to video",
        onScreenText: "Repository \u001a finished video",
        brollCue: "Show\u0007 the final output",
      },
    ]);

    expect(scenes[0].onScreenText).toBe("Repository → finished video");
    expect(scenes[0].brollCue).toBe("Show the final output");
  });
});
