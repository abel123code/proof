import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  listAccessRequests,
  listAllProfiles,
  listAllowedUsers,
  listBugReports,
  listWallets,
} from "@/lib/db";

export const runtime = "nodejs";

// Admin dashboard data: active users (with credit balances), the approved
// allowlist, pending sign-in requests, and beta bug reports. Admin-gated.
// One payload so the page keeps a single load + forbidden path.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const [profiles, allowed, requests, wallets, bugReports] = await Promise.all([
      listAllProfiles(),
      listAllowedUsers(),
      listAccessRequests(),
      listWallets(),
      listBugReports(),
    ]);
    return NextResponse.json({ profiles, allowed, requests, wallets, bugReports });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
