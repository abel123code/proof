import { NextResponse } from "next/server";
import {
  deleteSceneFootage,
  listSceneFootage,
  uploadSceneFootage,
} from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const briefId = searchParams.get("briefId");
    if (!briefId) {
      return NextResponse.json({ error: "briefId is required" }, { status: 400 });
    }
    const footage = await listSceneFootage(briefId);
    return NextResponse.json({ footage });
  } catch (err) {
    console.error("footage GET failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const briefId = form.get("briefId");
    const sceneIndexRaw = form.get("sceneIndex");
    const file = form.get("file");

    if (typeof briefId !== "string" || typeof sceneIndexRaw !== "string") {
      return NextResponse.json(
        { error: "briefId and sceneIndex are required" },
        { status: 400 },
      );
    }
    const sceneIndex = Number(sceneIndexRaw);
    if (Number.isNaN(sceneIndex)) {
      return NextResponse.json({ error: "sceneIndex must be a number" }, { status: 400 });
    }
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = file.type || "video/webm";

    const url = await uploadSceneFootage({ briefId, sceneIndex, bytes, contentType });
    return NextResponse.json({ sceneIndex, url });
  } catch (err) {
    console.error("footage POST failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
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
    await deleteSceneFootage(briefId, sceneIndex);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("footage DELETE failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
