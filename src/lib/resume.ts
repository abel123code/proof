import type { Project } from "@/lib/types";

// Which studio stage a project should resume into.
export type ResumeStage = "research" | "brief";

/** Minimal shape of the latest brief needed to decide a project's stage. */
export interface LatestBriefSummary {
  doc: unknown | null;
  renderUrl: string | null;
  renderStatus: string | null;
  createdAt: string;
}

/** A project plus the computed "where to resume" metadata for the connect list. */
export interface ProjectProgress {
  id: string;
  name: string;
  repoUrl: string;
  stage: ResumeStage;
  label: string;
  href: string;
  /** ISO timestamp of the most recent activity, used for ordering. */
  lastActivity: string;
  hasRender: boolean;
}

function isRenderInFlight(status: string | null | undefined): boolean {
  return !!status && status !== "done" && status !== "error";
}

/**
 * Decide which stage a project resumes into, purely from its saved state.
 * A brief with a doc means the user reached "Brief & Film"; otherwise they're
 * still in (or have not started) research. No I/O so it can be unit-tested.
 */
export function resolveResumeStage(
  project: Project,
  latestBrief: LatestBriefSummary | null,
): ProjectProgress {
  const q = `?project=${project.id}`;

  // Latest of every timestamp we know about (ISO strings sort chronologically).
  const lastActivity =
    [project.createdAt, project.researchUpdatedAt, latestBrief?.createdAt]
      .filter((t): t is string => Boolean(t))
      .sort()
      .at(-1) ?? project.createdAt;

  let stage: ResumeStage;
  let label: string;

  if (latestBrief?.doc) {
    stage = "brief";
    if (latestBrief.renderUrl) label = "Video ready";
    else if (isRenderInFlight(latestBrief.renderStatus)) label = "Rendering";
    else label = "Brief & Film";
  } else {
 // Research started (or repo only analyzed), next action is Research & Plan.
    stage = "research";
    label = "Research & Plan";
  }

  return {
    id: project.id,
    name: project.name,
    repoUrl: project.repoUrl,
    stage,
    label,
    href: stage === "brief" ? `/brief${q}` : `/research${q}`,
    lastActivity,
    hasRender: Boolean(latestBrief?.renderUrl),
  };
}
