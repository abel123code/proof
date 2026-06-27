import { NextResponse } from "next/server";
import { getLatestBriefForReference } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const referenceVideoId = searchParams.get("referenceVideoId");

    if (!projectId || !referenceVideoId) {
      return NextResponse.json(
        { error: "projectId and referenceVideoId are required." },
        { status: 400 },
      );
    }

    const brief = await getLatestBriefForReference(projectId, referenceVideoId);
    if (!brief?.doc) {
      return NextResponse.json({ brief: null });
    }

    return NextResponse.json({
      brief: {
        id: brief.id,
        doc: brief.doc,
        gaps: brief.gaps ?? [],
        answers: brief.answers ?? {},
      },
    });
  } catch (err) {
    console.error("brief GET failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
