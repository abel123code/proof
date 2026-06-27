import { NextResponse } from "next/server";
import { fetchRepoSnapshot } from "@/lib/github";
import { openaiJSON } from "@/lib/openai";
import { createProject } from "@/lib/db";
import type { ProjectUnderstanding } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You analyze a software project from its repo and explain it for a short-form "I built X" video.
Return ONLY a JSON object with this exact shape:
{
  "oneLiner": "one sentence describing what this is",
  "summary": "2-3 sentences on what it does",
  "problem": "the core problem it solves",
  "stack": ["notable languages / frameworks / libraries"],
  "interesting": "the single most technically interesting decision or feature",
  "audience": "who would care about this",
  "talkingPoints": ["3-5 short, punchy points usable in a script"]
}
Be concrete and avoid generic marketing fluff.`;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const repoUrl: unknown = body?.repoUrl;
    if (typeof repoUrl !== "string" || !repoUrl.trim()) {
      return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
    }

    const snapshot = await fetchRepoSnapshot(repoUrl);

    const understanding = await openaiJSON<ProjectUnderstanding>({
      system: SYSTEM,
      user: JSON.stringify({
        name: snapshot.name,
        description: snapshot.description,
        languages: snapshot.languages,
        fileTree: snapshot.fileTree,
        readme: snapshot.readme,
      }),
    });

    const project = await createProject({
      repoUrl,
      name: snapshot.name,
      understanding,
    });

    return NextResponse.json({ project });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
