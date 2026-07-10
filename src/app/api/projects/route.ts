import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { listProjects } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const projects = await listProjects(auth.userId);
    return NextResponse.json({ projects });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
