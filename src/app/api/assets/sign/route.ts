import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { assertBriefOwnedBy, createAssetUploadTicket } from "@/lib/db";

export const runtime = "nodejs";

// SVG is excluded even though the `brand-assets` bucket permits it: an SVG is a
// script-bearing document, not just pixels, and these files are fetched and composited
// directly by the render worker. A raster-only rule keeps that fetch-and-composite
// surface boring.
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Mint a signed upload ticket so the browser can PUT a brand screenshot or logo straight
 * to Supabase Storage. Body: { briefId, contentType } -> { path, token }.
 * The image bytes never pass through this function, so there's no Vercel body limit.
 */
export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const briefId: unknown = body?.briefId;
    const contentType: unknown = body?.contentType;

    if (typeof briefId !== "string") {
      return NextResponse.json({ error: "briefId is required" }, { status: 400 });
    }
    if (typeof contentType !== "string" || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: "contentType must be image/png, image/jpeg, or image/webp" },
        { status: 400 },
      );
    }
    if (!(await assertBriefOwnedBy(briefId, auth.userId))) {
      return NextResponse.json({ error: "Not your brief." }, { status: 403 });
    }

    const ticket = await createAssetUploadTicket({ briefId, contentType });
    return NextResponse.json(ticket); // { path, token }
  } catch (err) {
    console.error("asset sign failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
