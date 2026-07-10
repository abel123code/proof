import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { getProject, saveResearch } from "@/lib/db";
import { extractProof, researchTopics } from "@/lib/research";
import type { ResearchOutput } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Stage 02 "Research & Plan" - step 1: product positioning + problem-space topics.
 * Both are product-specific and persisted per project, so re-entry is free -
 * web search only runs on the first run or an explicit `force` re-run.
 */
export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    const force = Boolean(body?.force);
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }

    const project = await getProject(projectId);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    if (!project.understanding) {
      return NextResponse.json(
        { error: "Connect a GitHub profile first - research needs steering context." },
        { status: 400 },
      );
    }

    // Positioning: reuse the persisted value; only extract when missing or forced.
    const proof =
      (!force && project.research?.proof) || (await extractProof(project.understanding));

    // Topics: persisted per project (seeded by positioning). Reuse unless forced
    // or absent, so we only hit web search on the first run / explicit re-run.
    const cached = project.research?.topics;
    const topics =
      !force && cached && cached.length > 0
        ? cached
        : await researchTopics({
            targetUser: proof.targetUser,
            problemSpace: proof.problemSpace,
            topics: proof.topics,
          });

    const research: ResearchOutput = {
      proof,
      topics,
      // Preserve any scored angle sets so refreshing proof/topics never wipes them.
      angleSets: project.research?.angleSets,
      lastKey: project.research?.lastKey,
      updatedAt: new Date().toISOString(),
    };
    await saveResearch(projectId, research).catch(() => {});

    return NextResponse.json(research);
  } catch (err) {
    console.error("research failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
