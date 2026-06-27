import { NextResponse } from "next/server";
import { generateBrief } from "@/lib/brief";
import {
  createBrief,
  getProject,
  getReferenceVideo,
  listBriefs,
} from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  try {
    const briefs = await listBriefs();
    return NextResponse.json({ briefs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    const referenceVideoId: string | undefined = body?.referenceVideoId;

    if (!projectId || !referenceVideoId) {
      return NextResponse.json(
        { error: "projectId and referenceVideoId are required." },
        { status: 400 },
      );
    }

    const [project, reference] = await Promise.all([
      getProject(projectId),
      getReferenceVideo(referenceVideoId),
    ]);

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    if (!project.understanding) {
      return NextResponse.json(
        { error: "Project has no understanding yet - analyze the repo first." },
        { status: 400 },
      );
    }
    if (!reference) {
      return NextResponse.json({ error: "Reference video not found." }, { status: 404 });
    }
    if (!reference.structure) {
      return NextResponse.json(
        { error: "Reference video isn't analysed yet - analyse it in the pool first." },
        { status: 400 },
      );
    }

    const content = await generateBrief({
      understanding: project.understanding,
      structure: reference.structure,
      referenceCaption: reference.caption,
    });

    const brief = await createBrief({
      projectId,
      referenceVideoId,
      content,
    });

    return NextResponse.json({ brief });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
