import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { assertBriefOwnedBy, createAssetUploadTicket } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Mint a signed upload ticket for one brand-asset image so the browser can PUT it straight to
 * Supabase Storage. Body: { briefId, filename, contentType } -> { path, token, signedUrl, publicUrl }.
 * The image bytes never pass through this function.
 */
export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const briefId: unknown = body?.briefId;
    const filename: unknown = body?.filename;

    if (typeof briefId !== "string" || typeof filename !== "string" || !filename) {
      return NextResponse.json({ error: "briefId and filename are required" }, { status: 400 });
    }
    if (!(await assertBriefOwnedBy(briefId, auth.userId))) {
      return NextResponse.json({ error: "Not your brief." }, { status: 403 });
    }

    const ticket = await createAssetUploadTicket({ briefId, filename });
    return NextResponse.json(ticket); // { path, token, signedUrl, publicUrl }
  } catch (err) {
    console.error("asset sign failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
