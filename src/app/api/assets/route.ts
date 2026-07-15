import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { assertBriefOwnedBy, getBriefById, saveBriefAssets } from "@/lib/db";
import { sanitizeAssets } from "@/lib/assets";

export const runtime = "nodejs";

/** Read a brief's saved assets folder. Body query: ?briefId=... -> { assets }. */
export async function GET(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const briefId = new URL(req.url).searchParams.get("briefId");
    if (!briefId) return NextResponse.json({ error: "briefId is required" }, { status: 400 });
    if (!(await assertBriefOwnedBy(briefId, auth.userId))) {
      return NextResponse.json({ error: "Not your brief." }, { status: 403 });
    }
    const brief = await getBriefById(briefId);
    return NextResponse.json({ assets: brief?.assets ?? null });
  } catch (err) {
    console.error("asset GET failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Persist the assembled assets folder onto a brief. The image files were already uploaded via
 * /api/assets/sign; this stores their URLs plus brand color / motif. Body: { briefId, assets }.
 */
export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const briefId: unknown = body?.briefId;
    const raw = body?.assets;

    if (typeof briefId !== "string" || !raw || typeof raw !== "object") {
      return NextResponse.json({ error: "briefId and assets are required" }, { status: 400 });
    }
    if (!(await assertBriefOwnedBy(briefId, auth.userId))) {
      return NextResponse.json({ error: "Not your brief." }, { status: 403 });
    }

    const assets = sanitizeAssets(raw as Record<string, unknown>);
    await saveBriefAssets(briefId, assets);
    return NextResponse.json({ ok: true, assets });
  } catch (err) {
    console.error("asset save failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
