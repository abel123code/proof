import { NextResponse } from "next/server";
import { draftBriefDoc } from "@/lib/content-brief";
import { getProject, getReferenceVideo, saveBriefDoc } from "@/lib/db";
import type { InfoGap } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    const referenceVideoId: string | undefined = body?.referenceVideoId;
    const trendIndex: number = Number(body?.trendIndex);
    const gaps: InfoGap[] = Array.isArray(body?.gaps) ? body.gaps : [];
    const answers: Record<string, string> =
      body?.answers && typeof body.answers === "object" ? body.answers : {};

    if (!projectId || !referenceVideoId || Number.isNaN(trendIndex)) {
      return NextResponse.json(
        { error: "projectId, trendIndex and referenceVideoId are required." },
        { status: 400 },
      );
    }

    const [project, reference] = await Promise.all([
      getProject(projectId),
      getReferenceVideo(referenceVideoId),
    ]);

    if (!project?.understanding) {
      return NextResponse.json({ error: "Project has no understanding." }, { status: 400 });
    }
    if (!reference?.structure) {
      return NextResponse.json({ error: "Reference clip isn't analysed yet." }, { status: 400 });
    }
    const trend = project.trendResearch?.trends?.[trendIndex];
    if (!trend) {
      return NextResponse.json(
        { error: "Chosen trend not found - re-run research." },
        { status: 400 },
      );
    }

    const doc = await draftBriefDoc(
      {
        understanding: project.understanding,
        trend,
        structure: reference.structure,
        referenceCaption: reference.caption,
      },
      gaps,
      answers,
    );

    const saved = await saveBriefDoc({
      projectId,
      referenceVideoId,
      doc,
      gaps,
      answers,
    });

    return NextResponse.json({ id: saved.id, doc, gaps, answers });
  } catch (err) {
    console.error("brief/draft failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
