import { NextResponse } from "next/server";
import { listReferenceVideos } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const videos = await listReferenceVideos();
    return NextResponse.json({ videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
