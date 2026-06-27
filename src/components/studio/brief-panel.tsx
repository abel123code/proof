"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker, SectionMarker } from "@/components/studio/primitives";
import { Teleprompter } from "@/components/studio/teleprompter";
import type { BriefDoc, InfoGap, Project } from "@/lib/types";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type Phase = "loading" | "gaps" | "questions" | "drafting" | "brief";

export function BriefPanel() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const trendIndex = searchParams.get("trend");
  const referenceVideoId = searchParams.get("ref");
  const gapsStarted = useRef(false);

  const [project, setProject] = useState<Project | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [gaps, setGaps] = useState<InfoGap[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [doc, setDoc] = useState<BriefDoc | null>(null);
  const [recordScene, setRecordScene] = useState<number | null>(null);

  const ready = !!projectId && trendIndex != null && !!referenceVideoId;

  const topic = useMemo(() => {
    if (!project?.trendResearch || trendIndex == null) return null;
    return project.trendResearch.trends[Number(trendIndex)]?.topic ?? null;
  }, [project, trendIndex]);

  const findGaps = useCallback(async () => {
    if (!ready) return;
    setPhase("gaps");
    try {
      const res = await fetch("/api/brief/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, trendIndex: Number(trendIndex), referenceVideoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not work out what's missing");
      setGaps(data.questions ?? []);
      setPhase("questions");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      setPhase("questions");
    }
  }, [ready, projectId, trendIndex, referenceVideoId]);

  // Load project + any saved brief. If none saved, auto-run the cheap gaps step.
  useEffect(() => {
    if (!ready) {
      setPhase("loading");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [projRes, briefRes] = await Promise.all([
          fetch("/api/projects").then((r) => r.json()),
          fetch(
            `/api/brief?projectId=${projectId}&referenceVideoId=${referenceVideoId}`,
          ).then((r) => r.json()),
        ]);
        if (cancelled) return;
        const p: Project | undefined = projRes.projects?.find(
          (x: Project) => x.id === projectId,
        );
        setProject(p ?? null);

        if (briefRes.brief?.doc) {
          setDoc(briefRes.brief.doc);
          setGaps(briefRes.brief.gaps ?? []);
          setAnswers(briefRes.brief.answers ?? {});
          setPhase("brief");
        } else if (!gapsStarted.current) {
          gapsStarted.current = true;
          findGaps();
        }
      } catch {
        if (!cancelled) setPhase("questions");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, projectId, referenceVideoId]);

  const draft = useCallback(async () => {
    if (!ready) return;
    setPhase("drafting");
    toast.info("Drafting your scene-by-scene brief.");
    try {
      const res = await fetch("/api/brief/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          trendIndex: Number(trendIndex),
          referenceVideoId,
          gaps,
          answers,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Draft failed");
      setDoc(data.doc);
      setPhase("brief");
      toast.success("Brief ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Draft failed");
      setPhase("questions");
    }
  }, [ready, projectId, trendIndex, referenceVideoId, gaps, answers]);

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-[920px] px-8 py-10">
        <SectionMarker n="04" title="Brief" />
        <div className="mt-6 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          Start from a clip. Go to{" "}
          <Link href="/clips" className="text-foreground underline underline-offset-2">
            03 Clips
          </Link>{" "}
          and analyse one, then hit “Use this”.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[920px] px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <SectionMarker n="04" title="Content brief" />
        {phase === "brief" && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPhase("questions")}>
              Edit answers & regenerate
            </Button>
            <Button size="sm" onClick={() => setRecordScene(0)}>
              ● Record
            </Button>
          </div>
        )}
      </div>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        A filmable, scene-by-scene brief for{" "}
        {topic ? <span className="font-medium text-foreground">{topic}</span> : "your topic"},
        grounded in your work and the clip&apos;s proven structure.
      </p>

      {phase === "loading" && <LoadingBlock label="Loading…" />}
      {phase === "gaps" && (
        <LoadingBlock label="Working out what I need from you that GitHub can't tell me…" />
      )}

      {phase === "questions" && (
        <QuestionsForm
          gaps={gaps}
          answers={answers}
          onChange={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
          onRefresh={findGaps}
          onSubmit={draft}
        />
      )}

      {phase === "drafting" && <BriefSkeleton />}

      {phase === "brief" && doc && (
        <BriefView doc={doc} onRecord={(i) => setRecordScene(i)} />
      )}

      {recordScene != null && doc && (
        <Teleprompter
          doc={doc}
          startScene={recordScene}
          onClose={() => setRecordScene(null)}
        />
      )}
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="mt-6 flex items-center gap-3 rounded-md border border-border bg-muted/40 p-4 text-sm">
      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function QuestionsForm({
  gaps,
  answers,
  onChange,
  onRefresh,
  onSubmit,
}: {
  gaps: InfoGap[];
  answers: Record<string, string>;
  onChange: (id: string, value: string) => void;
  onRefresh: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <Kicker>A few things GitHub can&apos;t tell me</Kicker>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          New questions
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Answer what you can — anything you skip, I&apos;ll fill with a clearly-marked assumption.
      </p>

      <div className="mt-4 space-y-4">
        {gaps.length === 0 && (
          <p className="text-sm text-muted-foreground">No questions — you can draft straight away.</p>
        )}
        {gaps.map((g) => (
          <div key={g.id}>
            <label className="text-sm font-medium">{g.question}</label>
            {g.why && <p className="mt-0.5 text-xs text-muted-foreground">{g.why}</p>}
            <Textarea
              value={answers[g.id] ?? ""}
              onChange={(e) => onChange(g.id, e.target.value)}
              placeholder={g.placeholder ?? "Optional"}
              rows={2}
              className="mt-1.5"
            />
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Button onClick={onSubmit}>Draft brief →</Button>
      </div>
    </div>
  );
}

function BriefView({ doc, onRecord }: { doc: BriefDoc; onRecord: (sceneIndex: number) => void }) {
  return (
    <div className="mt-7">
      <div className="rounded-lg border border-border bg-secondary/30 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-xl tracking-tight">{doc.title}</p>
          {doc.targetFeeling && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              feeling: {doc.targetFeeling}
            </span>
          )}
        </div>
        {doc.angle && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{doc.angle}</p>
        )}
        <div className="mt-3 rounded-md border-l-2 border-primary bg-card p-3">
          <Kicker>Hook</Kicker>
          <p className="mt-1 font-display text-lg leading-snug tracking-tight">{doc.hook}</p>
        </div>
        {doc.sources && doc.sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {doc.sources.map((u) => (
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
        )}
      </div>

      <div className="mt-6 space-y-3">
        {doc.scenes.map((s, i) => (
          <article key={i} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-primary">
                  SCENE {String(s.scene ?? i + 1).padStart(2, "0")}
                </span>
                <span className="font-display text-sm tracking-tight">{s.label}</span>
              </div>
              <div className="flex items-center gap-2">
                {s.durationSeconds ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    ~{s.durationSeconds}s
                  </span>
                ) : null}
                <button
                  onClick={() => onRecord(i)}
                  title="Record from this scene"
                  className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition hover:border-primary hover:text-primary"
                >
                  ▶ record
                </button>
              </div>
            </div>

            <p className="mt-2 text-[15px] leading-snug">{s.spokenLine}</p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {s.onScreenText && (
                <div className="rounded-md bg-muted/50 p-2">
                  <Kicker>On screen</Kicker>
                  <p className="mt-0.5 text-sm">{s.onScreenText}</p>
                </div>
              )}
              {s.brollCue && (
                <div className="rounded-md bg-muted/50 p-2">
                  <Kicker>Show / b-roll</Kicker>
                  <p className="mt-0.5 text-sm italic text-muted-foreground">{s.brollCue}</p>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      {doc.assumptions && doc.assumptions.length > 0 && (
        <div className="mt-6 rounded-md border border-dashed border-border p-4">
          <Kicker>Assumptions I made</Kicker>
          <ul className="mt-2 space-y-1">
            {doc.assumptions.map((a, i) => (
              <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary" className="shrink-0 font-mono text-[9px]">
                  guess
                </Badge>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BriefSkeleton() {
  return (
    <div className="mt-7 space-y-3">
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}
