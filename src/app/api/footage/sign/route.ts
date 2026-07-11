import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { assertBriefOwnedBy, createFootageUploadTicket } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Mint a signed upload ticket so the browser can PUT the clip straight to Supabase
 * Storage. Body: { briefId, sceneIndex, contentType } -> { path, token }.
 * The video bytes never pass through this function, so there's no Vercel body limit.
 */
export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const briefId: unknown = body?.briefId;
    const sceneIndex = Number(body?.sceneIndex);
    const contentType =
      typeof body?.contentType === "string" && body.contentType ? body.contentType : "video/webm";

    if (typeof briefId !== "string" || Number.isNaN(sceneIndex)) {
      return NextResponse.json(
        { error: "briefId and sceneIndex are required" },
        { status: 400 },
      );
    }
    if (!(await assertBriefOwnedBy(briefId, auth.userId))) {
      return NextResponse.json({ error: "Not your brief." }, { status: 403 });
    }

    const ticket = await createFootageUploadTicket({ briefId, sceneIndex, contentType });
    return NextResponse.json(ticket); // { path, token }
  } catch (err) {
    console.error("footage sign failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
