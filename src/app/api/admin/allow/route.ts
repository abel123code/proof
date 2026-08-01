import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { addAllowedUser, removeAllowedUser } from "@/lib/db";

export const runtime = "nodejs";

// Add an email (or handle) to the approved allowlist.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email : null;
    const githubUsername =
      typeof body?.githubUsername === "string" ? body.githubUsername : null;
    const note = typeof body?.note === "string" ? body.note : null;
    // Email is what actually grants access (see isAllowlisted). A handle-only entry would
    // sit in /admin looking approved and never let the person in, so reject it here.
    if (!email) {
      return NextResponse.json(
        { error: "An email is required. A GitHub handle alone does not grant access." },
        { status: 400 },
      );
    }
    await addAllowedUser({ email, githubUsername, note });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Remove an allowlist entry by id.
export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
    await removeAllowedUser(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
