import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  listAccessRequests,
  listAllProfiles,
  listAllowedUsers,
  listWallets,
} from "@/lib/db";

export const runtime = "nodejs";

// Admin dashboard data: active users (with credit balances), the approved
// allowlist, and pending sign-in requests. Admin-gated.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const [profiles, allowed, requests, wallets] = await Promise.all([
      listAllProfiles(),
      listAllowedUsers(),
      listAccessRequests(),
      listWallets(),
    ]);
    return NextResponse.json({ profiles, allowed, requests, wallets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
