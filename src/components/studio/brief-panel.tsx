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
  const [briefId, setBriefId] = useState<string | null>(null);
  const [footage, setFootage] = useState<Record<number, string>>({});
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
          setBriefId(briefRes.brief.id ?? null);
          setPhase("brief");
          if (briefRes.brief.id) {
            fetch(`/api/footage?briefId=${briefRes.brief.id}`)
              .then((r) => r.json())
              .then((d) => {
                if (!cancelled && d.footage) setFootage(d.footage);
              })
              .catch(() => {});
          }
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
      setBriefId(data.id ?? null);
      setFootage({});
      setPhase("brief");
      toast.success("Brief ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Draft failed");
      setPhase("questions");
    }
  }, [ready, projectId, trendIndex, referenceVideoId, gaps, answers]);

  const exportBrief = useCallback(() => {
    if (!doc) return;
    const payload = {
      title: doc.title,
      hook: doc.hook,
      angle: doc.angle,
      targetFeeling: doc.targetFeeling ?? null,
      sources: doc.sources ?? [],
      fps: 30,
      format: { width: 1080, height: 1920 },
      scenes: doc.scenes.map((s, i) => ({
        index: i,
        scene: s.scene ?? i + 1,
        label: s.label,
        spokenLine: s.spokenLine,
        onScreenText: s.onScreenText ?? "",
        brollCue: s.brollCue ?? "",
        durationSeconds: s.durationSeconds ?? null,
        footageUrl: footage[i] ?? null,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(doc.title || "brief")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("brief.json downloaded — ready for Remotion");
  }, [doc, footage]);

  const uploadFootage = useCallback(
    async (sceneIndex: number, file: File) => {
      if (!briefId) {
        toast.error("Generate the brief first.");
        return;
      }
      const id = toast.loading(`Uploading scene ${sceneIndex + 1}…`);
      try {
        const fd = new FormData();
        fd.append("briefId", briefId);
        fd.append("sceneIndex", String(sceneIndex));
        fd.append("file", file, file.name);
        const res = await fetch("/api/footage", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        setFootage((m) => ({ ...m, [sceneIndex]: data.url }));
        toast.success(`Scene ${sceneIndex + 1} uploaded`, { id });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed", { id });
      }
    },
    [briefId],
  );

  const deleteFootage = useCallback(
    async (sceneIndex: number) => {
      if (!briefId) return;
      try {
        const res = await fetch("/api/footage", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ briefId, sceneIndex }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error ?? "Delete failed");
        }
        setFootage((m) => {
          const next = { ...m };
          delete next[sceneIndex];
          return next;
        });
        toast.success("Footage deleted");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [briefId],
  );

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
            <Button size="sm" variant="outline" onClick={exportBrief}>
              ↓ Export for Remotion
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
        <BriefView
          doc={doc}
          footage={footage}
          onRecord={(i) => setRecordScene(i)}
          onUpload={uploadFootage}
          onDelete={deleteFootage}
        />
      )}

      {recordScene != null && doc && (
        <Teleprompter
          doc={doc}
          briefId={briefId}
          startScene={recordScene}
          initialFootage={footage}
          onFootageChange={(sceneIndex, url) =>
            setFootage((m) => {
              const next = { ...m };
              if (url) next[sceneIndex] = url;
              else delete next[sceneIndex];
              return next;
            })
          }
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

function BriefView({
  doc,
  footage,
  onRecord,
  onUpload,
  onDelete,
}: {
  doc: BriefDoc;
  footage: Record<number, string>;
  onRecord: (sceneIndex: number) => void;
  onUpload: (sceneIndex: number, file: File) => void;
  onDelete: (sceneIndex: number) => void;
}) {
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const filmed = doc.scenes.filter((_, i) => footage[i]).length;
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

      <div className="mt-6 flex items-center justify-between">
        <Kicker>Scenes</Kicker>
        <span className="font-mono text-[11px] text-muted-foreground">
          footage {filmed} / {doc.scenes.length}
        </span>
      </div>

      <div className="mt-2 space-y-3">
        {doc.scenes.map((s, i) => {
          const clip = footage[i];
          return (
          <article
            key={i}
            className={`rounded-lg border bg-card p-4 ${
              clip ? "border-primary/40" : "border-border"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-primary">
                  SCENE {String(s.scene ?? i + 1).padStart(2, "0")}
                </span>
                <span className="font-display text-sm tracking-tight">{s.label}</span>
                {clip ? (
                  <span className="font-mono text-[10px] text-primary">✓ filmed</span>
                ) : (
                  <span className="font-mono text-[10px] text-muted-foreground/60">✗ no footage</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {s.durationSeconds ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    ~{s.durationSeconds}s
                  </span>
                ) : null}
                {clip && (
                  <button
                    onClick={() => setViewUrl(clip)}
                    title="View footage"
                    className="rounded-full border border-primary/50 px-2 py-0.5 font-mono text-[10px] text-primary transition hover:bg-primary/10"
                  >
                    ▷ view
                  </button>
                )}
                <label
                  title="Upload footage from this device"
                  className="cursor-pointer rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition hover:border-primary hover:text-primary"
                >
                  ⬆ upload
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onUpload(i, f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  onClick={() => onRecord(i)}
                  title="Record from this scene"
                  className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition hover:border-primary hover:text-primary"
                >
                  ● {clip ? "re-record" : "record"}
                </button>
                {clip && (
                  <button
                    onClick={() => onDelete(i)}
                    title="Delete footage"
                    className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition hover:border-[#e0533d] hover:text-[#e0533d]"
                  >
                    ✕ delete
                  </button>
                )}
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
          );
        })}
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

      {viewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setViewUrl(null)}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <button
            onClick={() => setViewUrl(null)}
            aria-label="Close"
            className="absolute right-5 top-5 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg text-white/80 backdrop-blur transition hover:bg-white/20 hover:text-white"
          >
            ✕
          </button>
          <div
            className="relative z-10 aspect-[9/16] h-[88vh] max-h-[88vh] overflow-hidden rounded-[2rem] border-[5px] border-neutral-800 bg-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={viewUrl}
              controls
              autoPlay
              playsInline
              className="absolute inset-0 h-full w-full bg-black object-contain"
            />
          </div>
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
