import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { updateBugReportStatus } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Triage a bug report. Body: { id, action: "close" | "reopen" } -> { ok }.
 * The list itself comes back with the rest of the admin payload from
 * GET /api/admin/users, so the page keeps a single load path.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const id: unknown = body?.id;
    const action: unknown = body?.action;

    if (typeof id !== "string" || (action !== "close" && action !== "reopen")) {
      return NextResponse.json(
        { error: "id and action (close|reopen) are required" },
        { status: 400 },
      );
    }

    await updateBugReportStatus(id, action === "close" ? "closed" : "open");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("bug report triage failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
