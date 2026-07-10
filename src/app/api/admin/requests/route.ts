import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { approveAccessRequest, rejectAccessRequest } from "@/lib/db";

export const runtime = "nodejs";

// Approve or reject a pending sign-in request.
// Approve -> the request's email is added to the allowlist so they get in on next login.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id : null;
    const action = body?.action;
    if (!id || (action !== "approve" && action !== "reject")) {
      return NextResponse.json(
        { error: "id and action ('approve' | 'reject') are required." },
        { status: 400 },
      );
    }
    if (action === "approve") await approveAccessRequest(id);
    else await rejectAccessRequest(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
