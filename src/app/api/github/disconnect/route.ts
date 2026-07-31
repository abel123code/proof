import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { setProfileGithubInstallation } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Forget the installation on our side. This does NOT uninstall the App from GitHub, only the user
 * can do that, from their GitHub settings, so the UI says so explicitly rather than implying we
 * revoked something we cannot revoke.
 */
export async function POST() {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  await setProfileGithubInstallation(auth.userId, null);
  return NextResponse.json({ ok: true });
}
