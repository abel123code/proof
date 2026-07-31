import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { setProfileGithubInstallation } from "@/lib/db";
import { githubAppConfigured, verifyState } from "@/lib/github-app";

export const runtime = "nodejs";

/**
 * Where GitHub returns after the user installs the App. Persists the installation id (not a
 * credential, tokens are minted per request and never stored) against the user's profile.
 *
 * Both the session AND the signed state must agree on the user: the session alone would let a
 * crafted callback bind an attacker's installation to whoever clicks it.
 */
export async function GET(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!githubAppConfigured()) {
    return NextResponse.json({ error: "Private repos aren't enabled." }, { status: 501 });
  }

  const { searchParams } = new URL(req.url);
  const installationId = Number(searchParams.get("installation_id"));
  const state = searchParams.get("state") ?? "";

  const stateUserId = verifyState(state, Date.now());
  if (!stateUserId || stateUserId !== auth.userId) {
    return NextResponse.redirect(new URL("/connect?github=state_invalid", req.url));
  }
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return NextResponse.redirect(new URL("/connect?github=missing_installation", req.url));
  }

  await setProfileGithubInstallation(auth.userId, installationId);
  return NextResponse.redirect(new URL("/connect?github=connected", req.url));
}
