import { NextResponse } from "next/server";
import { listReferenceVideos, listReferenceVideosByQuery } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query");
    const videos = query
      ? await listReferenceVideosByQuery(query)
      : await listReferenceVideos();
    return NextResponse.json({ videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
