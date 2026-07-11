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
import { emitCreditsChanged } from "@/components/studio/credits";
import { Teleprompter } from "@/components/studio/teleprompter";
import { toRenderBrief } from "@/lib/render-brief";
import type { Angle, BriefDoc, InfoGap, Project, ReferencePattern } from "@/lib/types";

// The research stage hands the chosen angle to the brief via sessionStorage
// (too big for a query param). Brand-new-video path stores a freeform prompt.
const ANGLE_KEY = "proof.angle";
const REFS_KEY = "proof.references";
const FREEFORM_KEY = "proof.freeform";

function readStored<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// Demo insurance: set NEXT_PUBLIC_DEMO_RENDER_URL to a public path (e.g. /demo-render.mp4)
// to SKIP the live Zo render and reveal a pre-rendered MP4. Leave it unset/empty to use
// the real render pipeline.
const DEMO_RENDER_URL: string | null =
  process.env.NEXT_PUBLIC_DEMO_RENDER_URL || null;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type Phase = "loading" | "gaps" | "questions" | "drafting" | "brief" | "empty";

export function BriefPanel() {
  const searchParams = useSearchParams();
  const [projectId, setProjectId] = useState<string | null>(searchParams.get("project"));
  // Smoke-test mode: /brief?test=1 spins up a real one-scene brief so you can film
  // a single scene and hit "Send to editor" without the full pipeline.
  const testMode = searchParams.get("test") === "1";
  const gapsStarted = useRef(false);
  const testStarted = useRef(false);

  const [angle] = useState<Angle | null>(() => readStored<Angle>(ANGLE_KEY));
  const [references] = useState<ReferencePattern[]>(
    () => readStored<ReferencePattern[]>(REFS_KEY) ?? [],
  );
  const [freeformPrompt] = useState<string | null>(() => readStored<string>(FREEFORM_KEY));

  const [project, setProject] = useState<Project | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [gaps, setGaps] = useState<InfoGap[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [doc, setDoc] = useState<BriefDoc | null>(null);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [footage, setFootage] = useState<Record<number, string>>({});
  const [recordScene, setRecordScene] = useState<number | null>(null);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [showRender, setShowRender] = useState(false);

  // We can generate a brief if we have a plan (angle or freeform), or just view
  // a previously-saved brief when we have a project.
  const ready = !!angle || !!freeformPrompt || !!projectId;

  const topic = useMemo(() => angle?.title ?? null, [angle]);

  const briefInput = useMemo(
    () => ({ projectId, angle, freeformPrompt, references }),
    [projectId, angle, freeformPrompt, references],
  );

  const findGaps = useCallback(async () => {
    if (!angle && !freeformPrompt) {
      setPhase("questions");
      return;
    }
    setPhase("gaps");
    try {
      const res = await fetch("/api/brief/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(briefInput),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not work out what's missing");
      setGaps(data.questions ?? []);
      setPhase("questions");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      setPhase("questions");
    }
  }, [angle, freeformPrompt, briefInput]);

  // Test mode: create a real one-scene brief, then jump straight to the brief view.
  useEffect(() => {
    if (!testMode || testStarted.current) return;
    testStarted.current = true;
    let cancelled = false;
    (async () => {
      setPhase("loading");
      try {
        const res = await fetch("/api/test-brief", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not create test brief");
        if (cancelled) return;
        setDoc(data.doc);
        setBriefId(data.briefId);
        setFootage({});
        setPhase("brief");
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Test brief failed");
          setPhase("questions");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [testMode]);

  // Load project + any saved brief. If none saved, auto-run the cheap gaps step.
  useEffect(() => {
    if (testMode || !ready) {
      if (!testMode && !ready) setPhase("empty");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [projRes, briefRes] = await Promise.all([
          fetch("/api/projects").then((r) => r.json()),
          projectId
            ? fetch(`/api/brief?projectId=${projectId}`).then((r) => r.json())
            : Promise.resolve({ brief: null }),
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
          setRenderUrl(briefRes.brief.renderUrl ?? null);
          setRenderStatus(briefRes.brief.renderStatus ?? null);
          {
            const st: string | null = briefRes.brief.renderStatus ?? null;
            if (
              briefRes.brief.renderJobId &&
              !briefRes.brief.renderUrl &&
              st !== "done" &&
              st !== "error"
            ) {
              setRenderJobId(briefRes.brief.renderJobId);
            }
          }
          if (briefRes.brief.id) {
            fetch(`/api/footage?briefId=${briefRes.brief.id}`)
              .then((r) => r.json())
              .then((d) => {
                if (!cancelled && d.footage) setFootage(d.footage);
              })
              .catch(() => {});
          }
        } else if ((angle || freeformPrompt) && !gapsStarted.current) {
          gapsStarted.current = true;
          findGaps();
        } else {
          setPhase("empty");
        }
      } catch {
        if (!cancelled) setPhase(angle || freeformPrompt ? "questions" : "empty");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, projectId, angle, freeformPrompt]);

  const draft = useCallback(async () => {
    if (!angle && !freeformPrompt) return;
    setPhase("drafting");
    toast.info("Drafting your scene-by-scene brief.");
    try {
      const res = await fetch("/api/brief/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...briefInput, gaps, answers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Draft failed");
      setDoc(data.doc);
      setBriefId(data.id ?? null);
      if (data.projectId && !projectId) setProjectId(data.projectId);
      setFootage({});
      setPhase("brief");
      toast.success("Brief ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Draft failed");
      setPhase("questions");
    } finally {
      emitCreditsChanged();
    }
  }, [angle, freeformPrompt, briefInput, projectId, gaps, answers]);

  const sendToEditor = useCallback(async () => {
    if (!doc) return;

    // Demo mode: fake the pipeline then reveal the pre-rendered MP4.
    if (DEMO_RENDER_URL) {
      setRenderUrl(null);
      setShowRender(false);
      const steps = ["queued", "transcribing", "cutting", "rendering", "uploading"];
      for (const s of steps) {
        setRenderStatus(s);
        await new Promise((r) => setTimeout(r, 900));
      }
      setRenderStatus("done");
      setRenderUrl(DEMO_RENDER_URL);
      setShowRender(true);
      toast.success("Edited video ready");
      return;
    }

    if (!briefId) return;
    const videoUrls = doc.scenes.map((_, i) => footage[i]).filter(Boolean) as string[];
    if (videoUrls.length === 0) {
      toast.error("Film at least one scene first.");
      return;
    }
    const filmedScenes = doc.scenes.filter((_, i) => footage[i]);
    const brief = toRenderBrief(filmedScenes);
    setRenderUrl(null);
    setShowRender(false);
    setRenderStatus("queued");
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefId, videoUrls, brief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the render");
      setRenderJobId(data.jobId);
      toast.success("Sent to editor — rendering your cut…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
      setRenderStatus(null);
    } finally {
      emitCreditsChanged();
    }
  }, [doc, briefId, footage]);

  // Poll the render job until it finishes, then persist + reveal the edited video.
  useEffect(() => {
    if (!renderJobId || renderUrl || !briefId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/render?jobId=${renderJobId}&briefId=${briefId}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.status) setRenderStatus(data.status);
        if (data.status === "done" && data.url) {
          setRenderUrl(data.url);
          setRenderStatus("done");
          toast.success("Edited video ready");
        } else if (data.status === "error") {
          toast.error(data.error ?? "Render failed");
          setRenderJobId(null);
        }
      } catch {
        // transient; keep polling
      }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [renderJobId, renderUrl, briefId]);

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

  const filmedCount = doc ? doc.scenes.filter((_, i) => footage[i]).length : 0;
  const renderActive =
    !renderUrl &&
    !!renderStatus &&
    renderStatus !== "done" &&
    renderStatus !== "error";
  const RENDER_LABELS: Record<string, string> = {
    queued: "Queued…",
    transcribing: "Transcribing…",
    cutting: "Cutting…",
    rendering: "Rendering…",
    uploading: "Uploading…",
  };
  const renderStatusLabel = renderStatus
    ? RENDER_LABELS[renderStatus] ?? "Working…"
    : "Working…";

  if ((!ready && !testMode) || (phase === "empty" && !doc)) {
    return (
      <div className="mx-auto w-full max-w-[920px] px-8 py-10">
        <SectionMarker n="03" title="Brief" />
        <div className="mt-6 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          Pick an angle first. Go to{" "}
          <Link href="/research" className="text-foreground underline underline-offset-2">
            02 Research &amp; Plan
          </Link>{" "}
          and choose a scored angle (or start a brand-new video), then come back here.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[920px] px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <SectionMarker n="03" title="Content brief" />
        {phase === "brief" && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPhase("questions")}>
              Edit answers & regenerate
            </Button>
            <Button size="sm" variant="outline" onClick={exportBrief}>
              ↓ Export for Remotion
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRecordScene(0)}>
              ● Record
            </Button>
            {renderUrl ? (
              <>
                <Button size="sm" onClick={() => setShowRender(true)}>
                  ▶ View edited video
                </Button>
                <Button size="sm" variant="outline" onClick={sendToEditor}>
                  Re-render
                </Button>
              </>
            ) : renderActive ? (
              <Button size="sm" disabled>
                <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
                {renderStatusLabel}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={sendToEditor}
                disabled={!DEMO_RENDER_URL && filmedCount === 0}
              >
                ✦ Send to editor
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        A filmable, scene-by-scene brief for{" "}
        {topic ? <span className="font-medium text-foreground">{topic}</span> : "your angle"},
        grounded in your proof and a virality-scored plan.
      </p>

      {phase === "loading" && <BriefSkeleton />}
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

      {showRender && renderUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowRender(false)}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <button
            onClick={() => setShowRender(false)}
            aria-label="Close"
            className="absolute right-5 top-5 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg text-white/80 backdrop-blur transition hover:bg-white/20 hover:text-white"
          >
            ✕
          </button>
          <div
            className="relative z-10 flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/60">
              Edited by Zo
            </p>
            <div className="aspect-[9/16] h-[80vh] max-h-[80vh] overflow-hidden rounded-[2rem] border-[5px] border-neutral-800 bg-black shadow-2xl">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={renderUrl}
                controls
                autoPlay
                playsInline
                className="h-full w-full bg-black object-contain"
              />
            </div>
            <a
              href={renderUrl}
              download
              className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black transition hover:bg-white/90"
            >
              ↓ Download MP4
            </a>
          </div>
        </div>
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
    <div className="mt-7" aria-busy="true" aria-label="Loading brief">
      {/* Hero card — mirrors the title / angle / hook block of the real brief */}
      <div className="rounded-lg border border-border bg-secondary/30 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Skeleton className="h-6 w-2/3 max-w-xs" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-4/5" />
        <div className="mt-3 rounded-md border-l-2 border-primary/40 bg-card p-3">
          <Skeleton className="h-2.5 w-12" />
          <Skeleton className="mt-2 h-5 w-3/4" />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-20" />
      </div>

      {/* Scene cards */}
      <div className="mt-2 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-5/6" />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-12 w-full rounded-md" />
              <Skeleton className="h-12 w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
