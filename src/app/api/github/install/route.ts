import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { githubAppConfigured, installUrl, signState } from "@/lib/github-app";

export const runtime = "nodejs";

/**
 * Start the GitHub App install flow. Redirects to GitHub, where the USER picks which repositories
 * Proof may read. We never see a repo we were not explicitly granted.
 *
 * The signed `state` binds the callback to this signed-in user so a third party cannot hand someone
 * a crafted callback URL that attaches their installation to the victim's account.
 */
export async function GET() {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!githubAppConfigured()) {
    return NextResponse.json(
      { error: "Private repos aren't enabled on this deployment yet." },
      { status: 501 },
    );
  }

  return NextResponse.redirect(installUrl(signState(auth.userId, Date.now())));
}
