import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import { getProfile } from "@/lib/db";
import { listUserRepos, type PublicRepo } from "@/lib/github";
import { githubAppConfigured, listInstallationRepos } from "@/lib/github-app";
import { allowRepoList, withRepoListCache } from "@/lib/repo-list-guard";

export const runtime = "nodejs";
export const maxDuration = 30;

/** A row in the picker. `isPrivate` drives the "Private" badge in the UI. */
export type PickerRepo = PublicRepo & { isPrivate: boolean };

/**
 * Merge public + installation-granted private repos into one newest-first list.
 *
 * Pure so it can be tested without GitHub. De-duplicates by `fullName` because a repo made public
 * after install appears in both sources; the private/installation copy wins so the badge stays
 * honest.
 */
export function mergeRepoLists(
  publicRepos: PublicRepo[],
  privateRepos: (PublicRepo & { isPrivate: true })[],
): PickerRepo[] {
  const byName = new Map<string, PickerRepo>();
  for (const r of publicRepos) byName.set(r.fullName.toLowerCase(), { ...r, isPrivate: false });
  for (const r of privateRepos) byName.set(r.fullName.toLowerCase(), r);
  return [...byName.values()].sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
}

/**
 * Lists repos for the signed-in user: their public repos (via the shared server token) plus any
 * PRIVATE repos granted through the GitHub App installation. Private repos appear only when the
 * user installed the App and ticked them in GitHub's own UI.
 */
export async function GET(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(req.url);
    const override = searchParams.get("username")?.trim();
    const profile = override ? null : await getProfile(auth.userId).catch(() => null);
    const username = override || profile?.githubUsername || null;

    const installationId = profile?.githubInstallationId ?? null;
    const canUseApp = githubAppConfigured() && installationId !== null;

    // With an installation we can still list private repos even when no handle is saved.
    if (!username && !canUseApp) {
      return NextResponse.json(
        { error: "No GitHub handle set. Add one in Settings." },
        { status: 400 },
      );
    }

    // Listing anyone's public repos is intentional (contributors, employees, agencies), so the guard
    // is on RATE, not ownership: one shared GitHub token serves every user. Cache hits are free and
    // never count against the cap.
    const now = Date.now();
    let publicRepos: PublicRepo[] = [];
    if (username) {
      const key = username.toLowerCase();
      const cached = await withRepoListCache(key, now, async () => {
        if (!allowRepoList(auth.userId, now)) throw new Error("RATE_LIMITED");
        return listUserRepos(username);
      }).catch((err) => {
        if (err instanceof Error && err.message === "RATE_LIMITED") return "RATE_LIMITED" as const;
        throw err;
      });
      if (cached === "RATE_LIMITED") {
        return NextResponse.json(
          { error: "Too many repo lookups in a row. Give it a minute and try again." },
          { status: 429 },
        );
      }
      publicRepos = cached;
    }

 // A revoked or uninstalled App must not break the picker, degrade to public-only and say why.
    let privateRepos: (PublicRepo & { isPrivate: true })[] = [];
    let privateError: string | null = null;
    if (canUseApp) {
      try {
        privateRepos = await listInstallationRepos(installationId);
      } catch (err) {
        privateError =
          err instanceof Error ? err.message : "Could not read private repos from GitHub.";
      }
    }

    return NextResponse.json({
      username,
      repos: mergeRepoLists(publicRepos, privateRepos),
      githubApp: {
        available: githubAppConfigured(),
        connected: canUseApp && !privateError,
        privateCount: privateRepos.length,
        error: privateError,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
