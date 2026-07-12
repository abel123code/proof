import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { findInfoGaps } from "@/lib/content-brief";
import { assertProjectOwnedBy, getProject } from "@/lib/db";
import { extractProof } from "@/lib/research";
import type { Angle, ReferencePattern } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    const angle: Angle | null = body?.angle && typeof body.angle === "object" ? body.angle : null;
    const freeformPrompt: string | null =
      typeof body?.freeformPrompt === "string" ? body.freeformPrompt.trim() || null : null;
    const references: ReferencePattern[] = Array.isArray(body?.references) ? body.references : [];

    if (!angle && !freeformPrompt) {
      return NextResponse.json(
        { error: "An angle or a freeform prompt is required." },
        { status: 400 },
      );
    }
    if (projectId && !(await assertProjectOwnedBy(projectId, auth.userId))) {
      return NextResponse.json({ error: "Not your project." }, { status: 403 });
    }

    const project = projectId ? await getProject(projectId) : null;
    const understanding = project?.understanding ?? null;
    const proof =
      project?.research?.proof ?? (understanding ? await extractProof(understanding) : null);

    const questions = await findInfoGaps({
      understanding,
      proof,
      angle,
      freeformPrompt,
      references,
    });

    return NextResponse.json({ questions });
  } catch (err) {
    console.error("brief/gaps failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
