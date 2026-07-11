import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import {
  assertBriefOwnedBy,
  deleteSceneFootage,
  listSceneFootage,
  recordSceneFootage,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(req.url);
    const briefId = searchParams.get("briefId");
    if (!briefId) {
      return NextResponse.json({ error: "briefId is required" }, { status: 400 });
    }
    if (!(await assertBriefOwnedBy(briefId, auth.userId))) {
      return NextResponse.json({ error: "Not your brief." }, { status: 403 });
    }
    const footage = await listSceneFootage(briefId);
    return NextResponse.json({ footage });
  } catch (err) {
    console.error("footage GET failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Confirm a direct upload. The browser has already PUT the clip to Supabase via a signed
 * ticket (POST /api/footage/sign); this records the scene_footage row. Body:
 * { briefId, sceneIndex, storagePath } -> { url }. No file transits this function.
 */
export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const briefId: unknown = body?.briefId;
    const sceneIndex = Number(body?.sceneIndex);
    const storagePath: unknown = body?.storagePath;

    if (typeof briefId !== "string" || Number.isNaN(sceneIndex) || typeof storagePath !== "string") {
      return NextResponse.json(
        { error: "briefId, sceneIndex and storagePath are required" },
        { status: 400 },
      );
    }
    if (!(await assertBriefOwnedBy(briefId, auth.userId))) {
      return NextResponse.json({ error: "Not your brief." }, { status: 403 });
    }
    // The signed path is derived server-side as `${briefId}/...`; reject anything else so a
    // confirm can't point a row at another brief's object.
    if (!storagePath.startsWith(`${briefId}/`)) {
      return NextResponse.json({ error: "invalid storagePath" }, { status: 400 });
    }

    const url = await recordSceneFootage({ briefId, sceneIndex, storagePath, userId: auth.userId });
    return NextResponse.json({ sceneIndex, url });
  } catch (err) {
    console.error("footage POST failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const briefId: unknown = body?.briefId;
    const sceneIndex = Number(body?.sceneIndex);
    if (typeof briefId !== "string" || Number.isNaN(sceneIndex)) {
      return NextResponse.json(
        { error: "briefId and sceneIndex are required" },
        { status: 400 },
      );
    }
    if (!(await assertBriefOwnedBy(briefId, auth.userId))) {
      return NextResponse.json({ error: "Not your brief." }, { status: 403 });
    }
    await deleteSceneFootage(briefId, sceneIndex);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("footage DELETE failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
