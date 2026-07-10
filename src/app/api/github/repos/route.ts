import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { getProfile } from "@/lib/db";
import { listUserRepos } from "@/lib/github";

export const runtime = "nodejs";
export const maxDuration = 30;

// Lists the public repos for the signed-in user's GitHub handle. The handle is
// resolved from the saved profile, or from an explicit ?username= override
// (used as the dev / localStorage fallback where there's no persisted profile).
export async function GET(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(req.url);
    const override = searchParams.get("username")?.trim();
    const profile = override ? null : await getProfile(auth.userId).catch(() => null);
    const username = override || profile?.githubUsername || null;

    if (!username) {
      return NextResponse.json(
        { error: "No GitHub handle set. Add one in Settings." },
        { status: 400 },
      );
    }

    const repos = await listUserRepos(username);
    return NextResponse.json({ username, repos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
