import { NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth";
import {
  assertProjectOwnedBy,
  getCachedReferences,
  getProject,
  refundCredits,
  saveResearch,
  setCachedReferences,
  spendCredits,
} from "@/lib/db";
import { CREDIT_COSTS } from "@/lib/pricing";
import { extractProof, researchReferences, scoreAngles } from "@/lib/research";
import type { ResearchOutput, SavedAngleSet, TrendTopic } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Stable key for an angle set, so we can cache/persist per topic or freeform prompt. */
function angleKey(topic: TrendTopic | null, freeformPrompt: string | null): string {
  if (topic) return `topic:${topic.topic.toLowerCase().trim()}`;
  return `freeform:${(freeformPrompt ?? "").toLowerCase().trim()}`;
}

/**
 * Stage 02 "Research & Plan" - step 2: reference-pattern mining + scored angles.
 * This is the ONE premium call, so it's behind the research-run rate limit AND
 * persisted per (project, topic). On revisit we return the saved set WITHOUT
 * spending quota or re-calling the model. Pass `force: true` to re-score.
 * Accepts either a chosen `topic` or a `freeformPrompt` (brand-new-video path).
 */
export async function POST(req: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Credits reserved on a cache miss (the premium path); refunded on failure.
  let charged = 0;
  try {
    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    const force = Boolean(body?.force);
    const freeformPrompt: string | null =
      typeof body?.freeformPrompt === "string" && body.freeformPrompt.trim()
        ? body.freeformPrompt.trim()
        : null;

    let topic: TrendTopic | null = null;
    if (body?.topic && typeof body.topic === "object") {
      topic = body.topic as TrendTopic;
    } else if (typeof body?.topic === "string" && body.topic.trim()) {
      topic = {
        topic: body.topic.trim(),
        whyTrending: "",
        whereDiscussed: "",
        sourceUrls: [],
      };
    }

    if (!topic && !freeformPrompt) {
      return NextResponse.json(
        { error: "Provide a topic or a freeform prompt." },
        { status: 400 },
      );
    }
    if (projectId && !(await assertProjectOwnedBy(projectId, auth.userId))) {
      return NextResponse.json({ error: "Not your project." }, { status: 403 });
    }

    const project = projectId ? await getProject(projectId) : null;
    const key = angleKey(topic, freeformPrompt);

    // Persisted-angles cache: if we've scored this exact selection before, return
    // it as-is. No quota spend, no model call - the whole point of the fix.
    if (!force && project?.research?.angleSets) {
      const hit = project.research.angleSets.find((s) => s.key === key);
      if (hit) {
        // Remember this as the last-viewed selection so the panel restores it.
        if (project.research.lastKey !== key) {
          await saveResearch(projectId!, { ...project.research, lastKey: key }).catch(
            () => {},
          );
        }
        return NextResponse.json({
          angles: hit.angles,
          references: hit.references,
          cached: true,
        });
      }
    }

    // Miss (or forced re-score): this is the metered premium path.
    const spend = await spendCredits(auth.userId, CREDIT_COSTS.angles);
    if (!spend.ok) {
      return NextResponse.json(
        { error: "You're out of credits.", creditsRemaining: 0 },
        { status: 402 },
      );
    }
    charged = CREDIT_COSTS.angles;

    const understanding = project?.understanding ?? null;
    const proof =
      project?.research?.proof ??
      (understanding ? await extractProof(understanding) : null);

    let references = topic ? await getCachedReferences(topic.topic) : [];
    if (topic && !references) {
      references = await researchReferences(topic.topic);
      await setCachedReferences(topic.topic, references).catch(() => {});
    }

    const angles = await scoreAngles({
      proof,
      understanding,
      topic,
      freeformPrompt,
      references: references ?? [],
    });

    // Persist the scored set onto the project (only when there's a project to hang
    // it on - a pure freeform run with no project stays ephemeral).
    if (project && projectId) {
      const now = new Date().toISOString();
      const set: SavedAngleSet = {
        key,
        topic,
        freeformPrompt,
        angles,
        references: references ?? [],
        updatedAt: now,
      };
      const prior = project.research;
      const nextSets = [
        ...(prior?.angleSets ?? []).filter((s) => s.key !== key),
        set,
      ];
      const nextResearch: ResearchOutput = {
        proof: prior?.proof ?? proof,
        topics: prior?.topics ?? [],
        angleSets: nextSets,
        lastKey: key,
        updatedAt: now,
      };
      await saveResearch(projectId, nextResearch).catch(() => {});
    }

    return NextResponse.json({
      angles,
      references: references ?? [],
      creditsRemaining: spend.remaining,
    });
  } catch (err) {
    if (charged) await refundCredits(auth.userId, charged).catch(() => {});
    console.error("angles failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
