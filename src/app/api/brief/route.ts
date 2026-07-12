import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { assertProjectOwnedBy, getLatestBriefForProject } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }
    if (!(await assertProjectOwnedBy(projectId, auth.userId))) {
      return NextResponse.json({ error: "Not your project." }, { status: 403 });
    }

    const brief = await getLatestBriefForProject(projectId);
    if (!brief?.doc) {
      return NextResponse.json({ brief: null });
    }

    return NextResponse.json({
      brief: {
        id: brief.id,
        doc: brief.doc,
        gaps: brief.gaps ?? [],
        answers: brief.answers ?? {},
        // Render state must round-trip so the panel can restore a finished/in-flight
        // render when the user leaves and comes back (otherwise it re-shows "Send to editor").
        renderJobId: brief.renderJobId ?? null,
        renderStatus: brief.renderStatus ?? null,
        renderUrl: brief.renderUrl ?? null,
      },
    });
  } catch (err) {
    console.error("brief GET failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
