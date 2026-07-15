import { NextResponse } from "next/server";
import { isAuthConfigured, requireApprovedUser } from "@/lib/auth";
import { getWallet, updateProfileGithub } from "@/lib/db";
import { parseUsername } from "@/lib/github";
import { CREDIT_COSTS } from "@/lib/pricing";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // requireApprovedUser already loaded the profile - reuse it instead of a
  // second identical query. Only the wallet still needs its own lookup.
  const profile = auth.profile;
  const wallet = await getWallet(auth.userId).catch(() => null);
  // Dev (auth off) is treated as admin so the /admin tools are reachable locally.
  const isAdmin = !isAuthConfigured() || Boolean(profile?.isAdmin);
  // Only expose the admin flag to actual admins. Regular users get no `isAdmin`
  // key at all, so the flag's existence isn't advertised in the network tab.
  // This is purely cosmetic - admin access is always enforced server-side by
  // requireAdmin() (DB check), never by trusting this client-visible value.
  return NextResponse.json({
    githubUsername: profile?.githubUsername ?? null,
    email: profile?.email ?? null,
    ...(isAdmin ? { isAdmin: true } : {}),
    creditsRemaining: wallet?.remaining ?? null,
    creditsTotal: wallet?.total ?? null,
    renderCost: CREDIT_COSTS.render,
  });
}

export async function PUT(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const raw: unknown = body?.githubUsername;
    if (typeof raw !== "string" || !raw.trim()) {
      return NextResponse.json({ error: "githubUsername is required." }, { status: 400 });
    }
    // Accepts a handle, "@name", or a profile URL; throws if it can't parse one.
    const githubUsername = parseUsername(raw);

    // Authed users persist to their profile; dev has no persistable profile, so we
    // just echo it back and the client keeps it in localStorage.
    await updateProfileGithub(auth.userId, githubUsername).catch(() => {});

    return NextResponse.json({ githubUsername });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
