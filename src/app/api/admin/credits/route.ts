import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { grantCredits } from "@/lib/db";

export const runtime = "nodejs";

// Admin top-up: add credits to a user's lifetime balance.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const userId: unknown = body?.userId;
    const amount = Number(body?.amount);
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "amount must be a non-zero number" }, { status: 400 });
    }
    await grantCredits(userId, Math.round(amount));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
