import { NextResponse } from "next/server";
import { researchTrends } from "@/lib/exa";
import { getProject, saveTrendResearch } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }

    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    if (!project.understanding) {
      return NextResponse.json(
        { error: "Connect a GitHub profile first - research needs steering context." },
        { status: 400 },
      );
    }

    const research = await researchTrends(project.understanding);
    const updated = await saveTrendResearch(projectId, research);

    return NextResponse.json({
      trendResearch: updated.trendResearch,
      updatedAt: updated.trendResearchUpdatedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
