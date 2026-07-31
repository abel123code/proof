import { NextResponse } from "next/server";
import { fetchRepoSnapshot, parseRepoUrl } from "@/lib/github";
import { OPENAI_MINI_MODEL, openaiJSON } from "@/lib/openai";
import { requireApprovedUser } from "@/lib/auth";
import { createProject, getProfile, getProjectByRepo, refundCredits, spendCredits } from "@/lib/db";
import {
  canAnalyseRepo,
  githubAppConfigured,
  installationCanAccess,
  installationOctokit,
} from "@/lib/github-app";
import { CREDIT_COSTS } from "@/lib/pricing";
import type { ProjectUnderstanding } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Repo-level: we look at ONE specific repo the user picked and distill a "builder
// profile" for it - the credibility base the rest of the pipeline (research ->
// brief) uses to prove they can actually build this thing.
const SYSTEM = `You analyze a single GitHub repository to build a "builder profile" for short-form "I build things" content.
The repository may be private, so never state or imply that a reader can go and browse it; describe the work itself.
You are given the repo's metadata, languages, README, and a shallow file tree.
Infer what this project actually is, the problem it solves, and what's genuinely impressive or technically interesting about it.

Return ONLY a JSON object with this exact shape:
{
  "oneLiner": "one sentence: what this project is / does",
  "summary": "2-3 sentences on what it does and the through-line of the work",
  "problem": "the core problem this project solves",
  "stack": ["notable languages / frameworks / tools it actually uses"],
  "interesting": "the single most impressive or technically interesting thing about it",
  "audience": "who would care about content on this (peers, recruiters, a niche)",
  "talkingPoints": ["3-5 short, punchy, credible points to make on camera"],
  "notableRepos": [{ "name": "repo", "url": "https://github.com/...", "description": "one line on what it is" }]
}
Set notableRepos to a single entry for THIS repo (use its real URL). Be concrete; avoid generic marketing fluff. Do not invent numbers.`;

export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Credits reserved up front (see below); refunded if the analysis fails.
  let charged = 0;
  try {
    const body = await req.json().catch(() => ({}));
    // Accept `repoUrl` (preferred) or `repo` (owner/repo). Either parses to owner/repo.
    const raw: unknown = body?.repoUrl ?? body?.repo;
    if (typeof raw !== "string" || !raw.trim()) {
      return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
    }

    const { owner, repo } = parseRepoUrl(raw);
    const repoUrl = `https://github.com/${owner}/${repo}`;
    const force = Boolean(body?.force);

    // Reuse an already-analyzed repo (keeps its saved research/angles) unless the
    // caller explicitly asks to re-analyze. Avoids a redundant model call + dupes.
    if (!force) {
      const existing = await getProjectByRepo(auth.userId, repoUrl);
      if (existing?.understanding) {
        return NextResponse.json({ project: existing, reused: true });
      }
    }

    // Ownership is checked BEFORE spending credits. Charging for a request we are about to reject
    // would take the user's credits and give them a 403.
    //
    // Private repos are readable only through the user's own GitHub App installation, and only for
    // the repos they granted, so the grant is checked explicitly rather than relying on GitHub's
    // misleading 404.
    const profile = await getProfile(auth.userId).catch(() => null);
    const installationId = profile?.githubInstallationId ?? null;
    const grantedByInstallation =
      githubAppConfigured() && installationId !== null
        ? await installationCanAccess(installationId, owner, repo)
        : false;

    // You analyse your own work. See canAnalyseRepo for why this is enforced and not just implied.
    if (
      !canAnalyseRepo({
        owner,
        profileHandle: profile?.githubUsername ?? null,
        grantedByInstallation,
      })
    ) {
      return NextResponse.json(
        {
          error: profile?.githubUsername
            ? `Proof only analyses your own repos, and ${owner}/${repo} belongs to ${owner}. If it is yours, connect it from the repo picker.`
            : "Save your GitHub handle in Settings first, then pick one of your repos.",
        },
        { status: 403 },
      );
    }

    // Charge only for a real analysis (past the reuse short-circuit and the ownership gate).
    const spend = await spendCredits(auth.userId, CREDIT_COSTS.repoAnalysis);
    if (!spend.ok) {
      return NextResponse.json(
        { error: "You're out of credits.", creditsRemaining: 0 },
        { status: 402 },
      );
    }
    charged = CREDIT_COSTS.repoAnalysis;

    const client =
      grantedByInstallation && installationId !== null
        ? installationOctokit(installationId)
        : undefined;

    const snapshot = await fetchRepoSnapshot(repoUrl, client);

    const understanding = await openaiJSON<ProjectUnderstanding>({
      model: OPENAI_MINI_MODEL,
      system: SYSTEM,
      user: JSON.stringify({
        name: snapshot.name,
        url: repoUrl,
        description: snapshot.description,
        languages: snapshot.languages,
        readme: snapshot.readme,
        fileTree: snapshot.fileTree,
      }),
    });

    // Guarantee notableRepos points at this repo even if the model omitted it.
    if (!Array.isArray(understanding.notableRepos) || understanding.notableRepos.length === 0) {
      understanding.notableRepos = [
        { name: snapshot.name, url: repoUrl, description: snapshot.description ?? "" },
      ];
    }

    const project = await createProject({
      repoUrl,
      name: snapshot.name,
      understanding,
      userId: auth.userId,
    });

    // The README is the main thing Proof reads. Without one the script is thin, and the user would
    // otherwise blame the connection ("I connected my repo but it didn't work"). Say so explicitly.
    return NextResponse.json({
      project,
      warning: snapshot.hasReadme
        ? undefined
        : `${snapshot.name} has no README, so Proof had little to work from. Add one and re-analyze for a much better script.`,
    });
  } catch (err) {
    if (charged) await refundCredits(auth.userId, charged).catch(() => {});
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
