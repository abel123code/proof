import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { assertProjectOwnedBy, getProject, refundCredits, saveResearch, spendCredits } from "@/lib/db";
import { CREDIT_COSTS } from "@/lib/pricing";
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

  // Credits reserved only when we actually run web-search research; refunded on failure.
  let charged = 0;
  try {
    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    const force = Boolean(body?.force);
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }
    if (!(await assertProjectOwnedBy(projectId, auth.userId))) {
      return NextResponse.json({ error: "Not your project." }, { status: 403 });
    }

    const project = await getProject(projectId);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    if (!project.understanding) {
      return NextResponse.json(
        { error: "Connect a GitHub profile first - research needs steering context." },
        { status: 400 },
      );
    }

    // Topics: persisted per project. Reuse unless forced or absent, so web search
    // (the metered cost) only runs on the first run / explicit re-run.
    const cached = project.research?.topics;
    const willFetch = force || !(cached && cached.length > 0);
    if (willFetch) {
      const spend = await spendCredits(auth.userId, CREDIT_COSTS.research);
      if (!spend.ok) {
        return NextResponse.json(
          { error: "You're out of credits.", creditsRemaining: 0 },
          { status: 402 },
        );
      }
      charged = CREDIT_COSTS.research;
    }

    // Positioning: reuse the persisted value; only extract when missing or forced.
    const proof =
      (!force && project.research?.proof) || (await extractProof(project.understanding));

    const topics = willFetch
      ? await researchTopics({
          targetUser: proof.targetUser,
          problemSpace: proof.problemSpace,
          topics: proof.topics,
        })
      : cached!;

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
    if (charged) await refundCredits(auth.userId, charged).catch(() => {});
    console.error("research failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
