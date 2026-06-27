import { NextResponse } from "next/server";
import { listReferenceVideos, deleteReferenceVideos } from "@/lib/db";
import { classifyFounderStory } from "@/lib/relevance";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Re-classify the existing pool against the founder-story filter and delete off-genre
 * rows. Already-analyzed rows are preserved (their Gemini structure is expensive to
 * recompute and was deliberately created).
 */
export async function POST() {
  try {
    const all = await listReferenceVideos();

    const protectedRows = all.filter((v) => v.status === "analyzed");
    const judged = all.filter((v) => v.status !== "analyzed");

    const keep = await classifyFounderStory(judged.map((v) => v.caption ?? ""));
    const toDelete = judged.filter((_, i) => !keep.has(i)).map((v) => v.id);

    const deleted = await deleteReferenceVideos(toDelete);

    return NextResponse.json({
      total: all.length,
      preservedAnalyzed: protectedRows.length,
      kept: judged.length - toDelete.length,
      deleted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
