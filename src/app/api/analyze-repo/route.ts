import { NextResponse } from "next/server";
import { fetchUserSnapshot } from "@/lib/github";
import { openaiJSON } from "@/lib/openai";
import { createProject } from "@/lib/db";
import type { ProjectUnderstanding } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Account-level: we look at WHAT THIS PERSON SHIPS across their public repos and
// distill a "builder profile" - the credibility base the rest of the pipeline
// (trend research -> brief -> script) uses to prove they can actually build.
const SYSTEM = `You analyze a developer's PUBLIC GitHub account to build a "builder profile" for short-form "I build things" content.
You are given the user's profile and their most recently active public repos (with READMEs for the top few).
Infer what this person actually builds, the through-line in their work, and what's genuinely impressive.

Return ONLY a JSON object with this exact shape:
{
  "oneLiner": "one sentence: what this person builds / who they are as a builder",
  "summary": "2-3 sentences on the kind of work they ship and the through-line",
  "problem": "the kinds of problems they tend to solve",
  "stack": ["notable languages / frameworks / tools they actually use"],
  "interesting": "the single most impressive or technically interesting thing across their work",
  "audience": "who would care about their content (peers, recruiters, a niche)",
  "talkingPoints": ["3-5 short, punchy, credible points they could make on camera"],
  "notableRepos": [{ "name": "repo", "url": "https://github.com/...", "description": "one line on why it stands out" }]
}
Pick 2-4 notableRepos from the provided repos (use their real URLs). Be concrete; avoid generic marketing fluff.`;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    // Accept `username` (preferred) or legacy `repoUrl` - both are parsed for a handle.
    const raw: unknown = body?.username ?? body?.repoUrl;
    if (typeof raw !== "string" || !raw.trim()) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    const snapshot = await fetchUserSnapshot(raw);

    if (snapshot.repos.length === 0) {
      return NextResponse.json(
        { error: `No public repos found for @${snapshot.username}.` },
        { status: 400 },
      );
    }

    const understanding = await openaiJSON<ProjectUnderstanding>({
      system: SYSTEM,
      user: JSON.stringify({
        username: snapshot.username,
        name: snapshot.name,
        bio: snapshot.bio,
        repos: snapshot.repos,
      }),
    });

    // Guarantee notableRepos exists even if the model omitted it.
    if (!Array.isArray(understanding.notableRepos)) {
      understanding.notableRepos = snapshot.repos.slice(0, 3).map((r) => ({
        name: r.name,
        url: r.url,
        description: r.description ?? "",
      }));
    }

    const project = await createProject({
      repoUrl: `https://github.com/${snapshot.username}`,
      name: snapshot.username,
      understanding,
    });

    return NextResponse.json({ project });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
