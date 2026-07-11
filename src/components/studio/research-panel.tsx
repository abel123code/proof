"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker, SectionMarker } from "@/components/studio/primitives";
import { emitCreditsChanged } from "@/components/studio/credits";
import { setActiveProject } from "@/components/studio/active-project";
import type {
  Angle,
  Proof,
  ReferencePattern,
  SavedAngleSet,
  TrendTopic,
} from "@/lib/types";

const ANGLE_KEY = "proof.angle";
const REFS_KEY = "proof.references";
const FREEFORM_KEY = "proof.freeform";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ResearchPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const projectId = params.get("project");

  const [proof, setProof] = useState<Proof | null>(null);
  const [topics, setTopics] = useState<TrendTopic[]>([]);
  const [researching, setResearching] = useState(false);
  const [researched, setResearched] = useState(false);
  // True while loading previously-saved research on mount, so we don't flash the
  // "Run research" CTA (which spends credits) before cached work has loaded.
  const [hydrating, setHydrating] = useState<boolean>(!!projectId);

  const [chosenTopic, setChosenTopic] = useState<number | null>(null);
  const [angles, setAngles] = useState<Angle[]>([]);
  const [references, setReferences] = useState<ReferencePattern[]>([]);
  const [scoring, setScoring] = useState(false);
  // Saved angle sets (per topic/freeform) hydrated from the DB, so revisiting a
  // topic reads locally instead of re-calling the premium model.
  const [angleSets, setAngleSets] = useState<SavedAngleSet[]>([]);

  const [freeformOpen, setFreeformOpen] = useState(false);
  const [freeform, setFreeform] = useState("");

  // Hydrate any previously-saved research for this project (cheap, no API spend).
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects");
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const p = data.projects?.find((x: { id: string }) => x.id === projectId);
        if (p) setActiveProject({ id: p.id, name: p.name ?? null });
        if (p?.research) {
          const research = p.research;
          setProof(research.proof ?? null);
          const hydratedTopics: TrendTopic[] = research.topics ?? [];
          setTopics(hydratedTopics);
          setResearched(true);

          // Restore any previously-scored angle sets + the last-viewed selection.
          const sets: SavedAngleSet[] = research.angleSets ?? [];
          setAngleSets(sets);
          const last = research.lastKey
            ? sets.find((s) => s.key === research.lastKey)
            : undefined;
          if (last) {
            setAngles(last.angles ?? []);
            setReferences(last.references ?? []);
            if (last.topic) {
              const idx = hydratedTopics.findIndex(
                (t) => t.topic === last.topic?.topic,
              );
              if (idx >= 0) setChosenTopic(idx);
            }
          }
        }
      } catch {
        // ignore - user can run research manually
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const runResearch = useCallback(async () => {
    if (!projectId) {
      toast.error("Connect a GitHub profile first.");
      return;
    }
    setResearching(true);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Research failed");
      setProof(data.proof ?? null);
      setTopics(data.topics ?? []);
      setResearched(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Research failed");
    } finally {
      setResearching(false);
      emitCreditsChanged();
    }
  }, [projectId]);

  const scoreForTopic = useCallback(
    async (index: number, force = false) => {
      setChosenTopic(index);
      const key = `topic:${topics[index]?.topic.toLowerCase().trim()}`;

      // Local cache hit: show the saved angles instantly, no request/model/quota.
      if (!force) {
        const hit = angleSets.find((s) => s.key === key);
        if (hit) {
          setAngles(hit.angles ?? []);
          setReferences(hit.references ?? []);
          return;
        }
      }

      setScoring(true);
      setAngles([]);
      try {
        const res = await fetch("/api/angles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, topic: topics[index], force }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not generate angles");
        setAngles(data.angles ?? []);
        setReferences(data.references ?? []);
        // Keep the local cache in sync so re-clicking is instant this session too.
        setAngleSets((prev) => [
          ...prev.filter((s) => s.key !== key),
          {
            key,
            topic: topics[index],
            angles: data.angles ?? [],
            references: data.references ?? [],
            updatedAt: new Date().toISOString(),
          },
        ]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not generate angles");
      } finally {
        setScoring(false);
        emitCreditsChanged();
      }
    },
    [projectId, topics, angleSets],
  );

  const scoreFreeform = useCallback(async () => {
    if (!freeform.trim()) return;
    setChosenTopic(null);
    setScoring(true);
    setAngles([]);
    try {
      const res = await fetch("/api/angles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, freeformPrompt: freeform.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not generate angles");
      setAngles(data.angles ?? []);
      setReferences(data.references ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate angles");
    } finally {
      setScoring(false);
      emitCreditsChanged();
    }
  }, [freeform, projectId]);

  const pickAngle = useCallback(
    (angle: Angle) => {
      try {
        window.sessionStorage.setItem(ANGLE_KEY, JSON.stringify(angle));
        window.sessionStorage.setItem(REFS_KEY, JSON.stringify(references));
        window.sessionStorage.removeItem(FREEFORM_KEY);
      } catch {
        // sessionStorage may be unavailable; brief page will just re-ask.
      }
      router.push(`/brief${projectId ? `?project=${projectId}` : ""}`);
    },
    [references, projectId, router],
  );

  const skipToBrief = useCallback(() => {
    if (!freeform.trim()) {
      toast.error("Describe the video you want to make.");
      return;
    }
    try {
      window.sessionStorage.setItem(FREEFORM_KEY, JSON.stringify(freeform.trim()));
      window.sessionStorage.removeItem(ANGLE_KEY);
      window.sessionStorage.removeItem(REFS_KEY);
    } catch {
      // ignore
    }
    router.push(`/brief${projectId ? `?project=${projectId}` : ""}`);
  }, [freeform, projectId, router]);

  return (
    <div className="mx-auto w-full max-w-[1040px] px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <SectionMarker n="02" title="Research & plan" />
        <Button
          size="sm"
          variant={freeformOpen ? "default" : "outline"}
          onClick={() => setFreeformOpen((v) => !v)}
        >
          {freeformOpen ? "× Close" : "＋ Brand-new video"}
        </Button>
      </div>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        We turn your repo into product positioning, research the relatable problems and
        topics your target users already care about, mine the patterns behind winning
        videos, and rank angles by how well they pull viewers toward trying your product.
        Pick the one to ride.
      </p>

      {freeformOpen && (
        <div className="mt-5 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <Kicker>Brand-new video</Kicker>
          <p className="mt-1 text-xs text-muted-foreground">
            Skip the research and describe the video you want. We&apos;ll still score angles
            for it — or jump straight to a brief.
          </p>
          <Textarea
            value={freeform}
            onChange={(e) => setFreeform(e.target.value)}
            rows={3}
            placeholder="e.g. Why indie founders can't get their first 100 users — and how my product fixes it."
            className="mt-3"
          />
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={scoreFreeform} disabled={scoring || !freeform.trim()}>
              {scoring ? "Scoring…" : "Score angles"}
            </Button>
            <Button size="sm" variant="outline" onClick={skipToBrief}>
              Skip to brief →
            </Button>
          </div>
        </div>
      )}

      {!projectId && (
        <div className="mt-6 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          Connect a GitHub profile first. Go to{" "}
          <Link href="/connect" className="text-foreground underline underline-offset-2">
            01 Connect GitHub
          </Link>
          .
        </div>
      )}

      {projectId && !researched && hydrating && (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-4">
          <Spinner />
          <p className="text-sm text-muted-foreground">Loading your saved research…</p>
        </div>
      )}

      {projectId && !researched && !hydrating && (
        <div className="mt-6">
          <Button onClick={runResearch} disabled={researching}>
            {researching ? "Researching the web…" : "✦ Run research"}
          </Button>
          {researching && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
                <Spinner />
                <div>
                  <p className="text-sm font-medium">Researching the web…</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Extracting your positioning and finding the relatable topics your
                    audience cares about. This usually takes ~20–40s.
                  </p>
                </div>
              </div>
              <Skeleton className="h-24 w-full animate-pulse rounded-lg" />
              <Skeleton className="h-24 w-full animate-pulse rounded-lg" />
            </div>
          )}
        </div>
      )}

      {proof && (
        <div className="mt-8">
          <Kicker>Your positioning</Kicker>
          <div className="mt-2 rounded-lg border border-border bg-secondary/30 p-4">
            <p className="font-display text-lg leading-snug tracking-tight">
              {proof.problemSpace || proof.uniqueAngle || proof.bestProofDrop}
            </p>
            {(proof.targetUser || proof.transformation) && (
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                {proof.targetUser && (
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Target user
                    </dt>
                    <dd className="mt-0.5 text-sm">{proof.targetUser}</dd>
                  </div>
                )}
                {proof.transformation && (
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Transformation
                    </dt>
                    <dd className="mt-0.5 text-sm">{proof.transformation}</dd>
                  </div>
                )}
              </dl>
            )}
            {proof.story && (
              <p className="mt-3 text-sm text-muted-foreground">{proof.story}</p>
            )}
            {(proof.topics?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {proof.topics.map((t, i) => (
                  <Badge key={i} variant="secondary" className="font-mono text-[11px]">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {topics.length > 0 && (
        <div className="mt-8">
          <Kicker>Topics your audience cares about</Kicker>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {topics.map((t, i) => {
              const active = chosenTopic === i;
              const loadingThis = scoring && active;
              return (
                <button
                  key={i}
                  onClick={() => scoreForTopic(i)}
                  disabled={scoring}
                  className={`flex flex-col rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed ${
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:border-foreground/30 disabled:opacity-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-display text-base leading-snug tracking-tight">
                      {t.topic}
                    </span>
                    {loadingThis ? (
                      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-primary">
                        <Spinner className="size-3" />
                        Scoring
                      </span>
                    ) : (
                      t.contentGap && (
                        <Badge className="shrink-0 bg-primary/15 font-mono text-[9px] text-primary">
                          gap
                        </Badge>
                      )
                    )}
                  </div>
                  {t.whyTrending && (
                    <p className="mt-1.5 text-xs text-muted-foreground">{t.whyTrending}</p>
                  )}
                  {t.sourceUrls.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.sourceUrls.map((u) => (
                        <span
                          key={u}
                          className="font-mono text-[10px] text-muted-foreground/70"
                        >
                          {hostOf(u)}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(scoring || angles.length > 0) && (
        <div className="mt-9">
          <div className="flex items-center justify-between gap-4">
            <Kicker>Angles, ranked by predicted virality</Kicker>
            {chosenTopic !== null && !scoring && angles.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => scoreForTopic(chosenTopic, true)}
              >
                ↻ Re-score
              </Button>
            )}
          </div>
          {scoring ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
                <Spinner />
                <div>
                  <p className="text-sm font-medium">
                    Scoring angles
                    {chosenTopic !== null && topics[chosenTopic]
                      ? ` for “${topics[chosenTopic].topic}”`
                      : ""}
                    …
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Mining winning video patterns and ranking angles by predicted
                    virality. This usually takes ~20–40s — hang tight.
                  </p>
                </div>
              </div>
              <Skeleton className="h-40 w-full animate-pulse rounded-lg" />
              <Skeleton className="h-40 w-full animate-pulse rounded-lg" />
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              {angles.map((a, i) => (
                <AngleCard key={a.id} angle={a} rank={i} onPick={() => pickAngle(a)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg
      className={`${className} shrink-0 animate-spin text-primary`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M12 2a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6V2z"
      />
    </svg>
  );
}

const DIMENSIONS: { key: keyof Angle["score"]; label: string }[] = [
  { key: "hook", label: "Hook" },
  { key: "shareability", label: "Share" },
  { key: "saveability", label: "Save" },
  { key: "emotion", label: "Emotion" },
  { key: "trendFit", label: "Trend" },
  { key: "relevance", label: "Relevant" },
];

function AngleCard({
  angle,
  rank,
  onPick,
}: {
  angle: Angle;
  rank: number;
  onPick: () => void;
}) {
  return (
    <article
      className={`rounded-xl border bg-card p-5 ${
        rank === 0 ? "border-primary ring-1 ring-primary/40" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {rank === 0 && (
              <Badge className="bg-primary font-mono text-[9px] uppercase text-primary-foreground">
                top pick
              </Badge>
            )}
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {angle.hookArchetype} · {angle.emotionalTrigger}
            </span>
          </div>
          <p className="mt-1.5 font-display text-xl leading-tight tracking-tight">
            {angle.title}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-3xl leading-none tracking-tight text-primary">
            {angle.score.total}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            virality
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-md border-l-2 border-primary bg-secondary/40 p-3">
        <Kicker>Hook</Kicker>
        <p className="mt-1 font-display text-lg leading-snug tracking-tight">{angle.hook}</p>
      </div>

      {angle.why && <p className="mt-3 text-sm text-muted-foreground">{angle.why}</p>}

      <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {DIMENSIONS.map((d) => (
          <div key={d.key}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {d.label}
              </span>
              <span className="font-mono text-[10px] text-foreground">{angle.score[d.key]}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${angle.score[d.key]}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        {angle.sources.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {angle.sources.slice(0, 3).map((u) => (
              <a
                key={u}
                href={u}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-primary underline-offset-2 hover:underline"
              >
                {hostOf(u)} ↗
              </a>
            ))}
          </div>
        ) : (
          <span />
        )}
        <Button size="sm" onClick={onPick}>
          Use this angle →
        </Button>
      </div>
    </article>
  );
}
