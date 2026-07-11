import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { listProjectsWithProgress } from "@/lib/db";

export const runtime = "nodejs";

// Projects annotated with their resume stage, powering the connect page's
// "Continue where you left off" list.
export async function GET() {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const projects = await listProjectsWithProgress(auth.userId);
    return NextResponse.json({ projects });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
