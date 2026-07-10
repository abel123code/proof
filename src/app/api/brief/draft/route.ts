import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { draftBriefDoc } from "@/lib/content-brief";
import { createProject, getProject, refundCredits, saveBriefDoc, spendCredits } from "@/lib/db";
import { CREDIT_COSTS } from "@/lib/pricing";
import { extractProof } from "@/lib/research";
import type { Angle, InfoGap, ReferencePattern } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Credits reserved before drafting; refunded on failure.
  let charged = 0;
  try {
    const body = await req.json().catch(() => ({}));
    let projectId: string | undefined = body?.projectId;
    const angle: Angle | null = body?.angle && typeof body.angle === "object" ? body.angle : null;
    const freeformPrompt: string | null =
      typeof body?.freeformPrompt === "string" ? body.freeformPrompt.trim() || null : null;
    const references: ReferencePattern[] = Array.isArray(body?.references) ? body.references : [];
    const gaps: InfoGap[] = Array.isArray(body?.gaps) ? body.gaps : [];
    const answers: Record<string, string> =
      body?.answers && typeof body.answers === "object" ? body.answers : {};

    if (!angle && !freeformPrompt) {
      return NextResponse.json(
        { error: "An angle or a freeform prompt is required." },
        { status: 400 },
      );
    }

    const spend = await spendCredits(auth.userId, CREDIT_COSTS.brief);
    if (!spend.ok) {
      return NextResponse.json(
        { error: "You're out of credits.", creditsRemaining: 0 },
        { status: 402 },
      );
    }
    charged = CREDIT_COSTS.brief;

    const project = projectId ? await getProject(projectId) : null;
    const understanding = project?.understanding ?? null;
    const proof =
      project?.research?.proof ?? (understanding ? await extractProof(understanding) : null);

    const doc = await draftBriefDoc(
      { understanding, proof, angle, freeformPrompt, references },
      gaps,
      answers,
    );

    // Brand-new-video path may have no project yet - create a lightweight one so
    // the brief (and its footage/render) has a home.
    if (!projectId) {
      const created = await createProject({
        repoUrl: "",
        name: angle?.title ?? "Freeform video",
        userId: auth.userId,
      });
      projectId = created.id;
    }

    const saved = await saveBriefDoc({
      projectId,
      doc,
      gaps,
      answers,
      userId: auth.userId,
    });

    return NextResponse.json({ id: saved.id, projectId, doc, gaps, answers });
  } catch (err) {
    if (charged) await refundCredits(auth.userId, charged).catch(() => {});
    console.error("brief/draft failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
