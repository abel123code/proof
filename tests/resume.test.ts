import { describe, expect, it } from "vitest";
import { resolveResumeStage, type LatestBriefSummary } from "@/lib/resume";
import type { Project } from "@/lib/types";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    repoUrl: "https://github.com/me/repo",
    name: "repo",
    understanding: null,
    research: null,
    researchUpdatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeBrief(overrides: Partial<LatestBriefSummary> = {}): LatestBriefSummary {
  return {
    doc: null,
    renderUrl: null,
    renderStatus: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveResumeStage", () => {
  it("resumes to research when only the repo is analyzed (no research, no brief)", () => {
    const r = resolveResumeStage(makeProject(), null);
    expect(r.stage).toBe("research");
    expect(r.href).toBe("/research?project=p1");
    expect(r.label).toBe("Research & Plan");
    expect(r.hasRender).toBe(false);
  });

  it("resumes to research when research exists but no brief yet", () => {
    const r = resolveResumeStage(
      makeProject({ research: { proof: null } as unknown as Project["research"] }),
      null,
    );
    expect(r.stage).toBe("research");
    expect(r.href).toBe("/research?project=p1");
  });

  it("resumes to brief when a brief doc exists", () => {
    const r = resolveResumeStage(makeProject(), makeBrief({ doc: { title: "x" } }));
    expect(r.stage).toBe("brief");
    expect(r.href).toBe("/brief?project=p1");
    expect(r.label).toBe("Brief & Film");
  });

  it("labels a rendering brief as Rendering", () => {
    const r = resolveResumeStage(
      makeProject(),
      makeBrief({ doc: { title: "x" }, renderStatus: "rendering" }),
    );
    expect(r.stage).toBe("brief");
    expect(r.label).toBe("Rendering");
    expect(r.hasRender).toBe(false);
  });

  it("labels a finished render as Video ready and flags hasRender", () => {
    const r = resolveResumeStage(
      makeProject(),
      makeBrief({ doc: { title: "x" }, renderStatus: "done", renderUrl: "https://x/v.mp4" }),
    );
    expect(r.stage).toBe("brief");
    expect(r.label).toBe("Video ready");
    expect(r.hasRender).toBe(true);
  });

  it("uses the newest timestamp across project + research + brief as lastActivity", () => {
    const r = resolveResumeStage(
      makeProject({ researchUpdatedAt: "2026-03-01T00:00:00.000Z" }),
      makeBrief({ doc: { title: "x" }, createdAt: "2026-02-01T00:00:00.000Z" }),
    );
    expect(r.lastActivity).toBe("2026-03-01T00:00:00.000Z");
  });
});
