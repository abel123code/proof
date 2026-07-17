import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { insertBugReport } from "@/lib/db";
import { sanitizeBugReport } from "@/lib/bug-report";

export const runtime = "nodejs";

/**
 * Submit a bug report from the studio. Body: { message, context } -> { ok }.
 * The context is whatever the client could attach (briefId / renderJobId / last
 * render error / url / browser); it's clamped server-side. Any approved user can
 * report — there's no brief to own, so requireApprovedUser is the right gate.
 */
export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const clean = sanitizeBugReport(body ?? {});
    if (!clean) {
      return NextResponse.json({ error: "Tell us what went wrong first." }, { status: 400 });
    }

    await insertBugReport({
      userId: auth.userId,
      email: auth.profile?.email ?? null,
      message: clean.message,
      context: clean.context,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("bug report failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
