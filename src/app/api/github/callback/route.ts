import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { getProfile, setProfileGithubInstallation } from "@/lib/db";
import {
  githubAppConfigured,
  installationAccountLogin,
  verifyState,
} from "@/lib/github-app";

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

  if (!Number.isInteger(installationId) || installationId <= 0) {
    return NextResponse.redirect(new URL("/connect?github=missing_installation", req.url));
  }

  // Path A: the user started from our "Connect private repos" button, so we issued a signed state.
  const stateUserId = verifyState(state, Date.now());
  if (stateUserId) {
    if (stateUserId !== auth.userId) {
      return NextResponse.redirect(new URL("/connect?github=state_invalid", req.url));
    }
    await setProfileGithubInstallation(auth.userId, installationId);
    return NextResponse.redirect(new URL("/connect?github=connected", req.url));
  }

  // Path B: the user installed straight from github.com/apps/<slug>, so GitHub sends them to the
  // app's setup URL with NO state of ours. Rejecting that would strand a real installation (the
  // user has installed, but Proof never learns the id and shows "not connected" forever).
  //
  // Without a signed state we cannot trust the URL, so verify OWNERSHIP instead: the installation
  // must belong to the GitHub account this user saved on their profile. That stops a crafted link
  // from binding someone else's installation to whoever clicks it.
  const profile = await getProfile(auth.userId).catch(() => null);
  const handle = profile?.githubUsername?.trim().toLowerCase();
  if (!handle) {
    return NextResponse.redirect(new URL("/connect?github=set_handle_first", req.url));
  }

  const owner = (await installationAccountLogin(installationId).catch(() => null))?.toLowerCase();
  if (!owner || owner !== handle) {
    return NextResponse.redirect(new URL("/connect?github=owner_mismatch", req.url));
  }

  await setProfileGithubInstallation(auth.userId, installationId);
  return NextResponse.redirect(new URL("/connect?github=connected", req.url));
}
