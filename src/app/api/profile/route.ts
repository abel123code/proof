import { NextResponse } from "next/server";
import { isAuthConfigured, requireApprovedUser } from "@/lib/auth";
import { getProfile, updateProfileGithub } from "@/lib/db";
import { parseUsername } from "@/lib/github";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const profile = await getProfile(auth.userId).catch(() => null);
  // Dev (auth off) is treated as admin so the /admin tools are reachable locally.
  const isAdmin = !isAuthConfigured() || Boolean(profile?.isAdmin);
  return NextResponse.json({
    githubUsername: profile?.githubUsername ?? null,
    isAdmin,
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
