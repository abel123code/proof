"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker, SectionMarker } from "@/components/studio/primitives";
import { emitCreditsChanged } from "@/components/studio/credits";
import { getActiveProject, setActiveProject } from "@/components/studio/active-project";
import {
  BRIEF_INPUT_PENDING_KEY,
  shouldResumeSavedBrief,
} from "@/components/studio/brief-selection";
import { getProfileData } from "@/components/studio/profile-store";
import { RenderConfirmDialog } from "@/components/studio/render-confirm-dialog";
import { Teleprompter } from "@/components/studio/teleprompter";
import {
  readFootageNames,
  removeFootageName,
  setFootageName,
} from "@/components/studio/footage-names";
import { toRenderBrief } from "@/lib/render-brief";
import { uploadSceneFootageDirect } from "@/lib/upload";
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
// to skip the live render worker and reveal a pre-rendered MP4. Leave it unset to use
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
  const router = useRouter();
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
  const [pendingCreativeInput] = useState(
    () => readStored<boolean>(BRIEF_INPUT_PENDING_KEY) === true,
  );

  const [project, setProject] = useState<Project | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [gaps, setGaps] = useState<InfoGap[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [doc, setDoc] = useState<BriefDoc | null>(null);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [footage, setFootage] = useState<Record<number, string>>({});
  // Human-readable label per scene (original filename, or "Recorded take"). Client-only,
 // localStorage-backed per brief, the DB stores footage at a fixed path, so this is what
  // lets a creator tell which of their recordings they attached. See footage-names.ts.
  const [filenames, setFilenames] = useState<Record<number, string>>({});
  const [recordScene, setRecordScene] = useState<number | null>(null);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [showRender, setShowRender] = useState(false);
  const [confirmRenderOpen, setConfirmRenderOpen] = useState(false);
  const [renderCost, setRenderCost] = useState<number | null>(null);
  const [deletingRender, setDeletingRender] = useState(false);
  const [downloadingRender, setDownloadingRender] = useState(false);
  // `angle`/`freeformPrompt` are seeded from localStorage, which is empty during SSR.
  // Gate any render that depends on them until after mount so the first client render
  // matches the server HTML (avoids a hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Footage URLs come from the DB, but the original filenames live only in the browser
  // (localStorage). Re-hydrate them whenever the brief changes so a reload still shows
  // "which clip is this?" per scene.
  useEffect(() => {
    setFilenames(readFootageNames(briefId));
  }, [briefId]);

 // Recover the project on a hard refresh where ?project= isn't in the URL, the
  // brand-new-video path only sets it in state, and the top-nav stepper links to a
  // bare /brief. Without this, a reload loses the saved brief AND its render state,
  // so a finished/in-flight edit reverts to "Send to editor". The active-project
  // store (localStorage) survives reloads. Skip when a fresh angle/freeform is
  // pending so we don't hijack a brand-new video with a stale stored project.
  useEffect(() => {
    if (testMode || projectId || angle || freeformPrompt) return;
    const stored = getActiveProject();
    if (stored?.id) setProjectId(stored.id);
  }, [testMode, projectId, angle, freeformPrompt]);

  // Keep ?project= in the URL once we know the project (from a draft, a resume, or
  // the store recovery above) so every subsequent refresh restores this exact brief.
  useEffect(() => {
    if (!projectId || searchParams.get("project") === projectId) return;
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("project", projectId);
    router.replace(`/brief?${params.toString()}`, { scroll: false });
  }, [projectId, searchParams, router]);

  // We can generate a brief if we have a plan (angle or freeform), or just view
  // a previously-saved brief when we have a project.
  const ready = !!angle || !!freeformPrompt || !!projectId;

  const topic = useMemo(() => (mounted ? angle?.title ?? null : null), [mounted, angle]);

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
        if (p) setActiveProject({ id: p.id, name: p.name ?? null });

        const savedBrief = briefRes.brief?.doc ?? null;
        if (shouldResumeSavedBrief(Boolean(savedBrief), pendingCreativeInput) && savedBrief) {
          setDoc(savedBrief);
          setGaps(briefRes.brief.gaps ?? []);
          setAnswers(briefRes.brief.answers ?? {});
          setBriefId(briefRes.brief.id ?? null);
          setPhase("brief");
          setRenderUrl(briefRes.brief.renderUrl || null);
          setRenderStatus(briefRes.brief.renderStatus ?? null);
          // Resume polling whenever a job exists but we don't yet have the final
          // video URL. The durable render_jobs row (updated by the render service)
 // is the source of truth, so even if the brief's status looks stale, or
 // the render finished while the tab was closed, the poll recovers the
          // real terminal state (and reveals the video) instead of stranding it.
          if (briefRes.brief.renderJobId && !briefRes.brief.renderUrl) {
            setRenderJobId(briefRes.brief.renderJobId);
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
      try {
        window.sessionStorage.removeItem(BRIEF_INPUT_PENDING_KEY);
      } catch {
        // sessionStorage may be unavailable; the saved brief still becomes the source of truth.
      }
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
      const steps = ["queued", "transcribing", "cutting", "planning", "rendering", "uploading"];
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
    const brief = toRenderBrief(filmedScenes, {
      hook: doc.hook,
      targetFeeling: doc.targetFeeling,
    });
    // Clear the previous job id first so the poll can't briefly hit the old job
    // (whose persisted URL would short-circuit us back to the stale video).
    setRenderJobId(null);
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
 toast.success("Sent to editor, rendering your cut…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
      setRenderStatus(null);
    } finally {
      emitCreditsChanged();
    }
  }, [doc, briefId, footage]);

  const requestRender = useCallback(async () => {
    if (DEMO_RENDER_URL) {
      await sendToEditor();
      return;
    }
    const profile = await getProfileData();
    if (profile?.renderCost == null) {
      toast.error("Could not verify the render cost. Please try again.");
      return;
    }
    setRenderCost(profile.renderCost);
    setConfirmRenderOpen(true);
  }, [sendToEditor]);

  // Poll the render job until it finishes, then persist + reveal the edited video.
  // Gated on the render STATUS (not renderUrl): a re-render leaves the old URL in
  // state briefly, and gating on it would stop us from ever polling the new job.
  useEffect(() => {
    if (!renderJobId || !briefId) return;
    if (renderStatus === "done" || renderStatus === "error") return;
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
  }, [renderJobId, briefId, renderStatus]);

  // Cross-origin (Supabase) URLs ignore the <a download> hint and just navigate,
  // so pull the file down as a blob and trigger a real save dialog.
  const downloadVideo = useCallback(async () => {
    if (!renderUrl) return;
    const name = `${(doc?.title || "proof-video")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "proof-video"}.mp4`;
    setDownloadingRender(true);
    try {
      const res = await fetch(renderUrl);
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in a new tab so the user can still save it manually.
      window.open(renderUrl, "_blank", "noopener");
    } finally {
      setDownloadingRender(false);
    }
  }, [renderUrl, doc]);

  const deleteRender = useCallback(async () => {
    if (!briefId) return;
    if (!window.confirm("Delete the edited video? This can't be undone.")) return;
    setDeletingRender(true);
    try {
      const res = await fetch("/api/render", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not delete the video");
      setRenderUrl(null);
      setRenderStatus(null);
      setRenderJobId(null);
      setShowRender(false);
      toast.success("Edited video deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingRender(false);
    }
  }, [briefId]);

  const uploadFootage = useCallback(
    async (sceneIndex: number, file: File) => {
      if (!briefId) {
        toast.error("Generate the brief first.");
        return;
      }
      const id = toast.loading(`Uploading scene ${sceneIndex + 1}… 0%`);
      try {
        // Direct browser -> Supabase (signed URL); no Vercel body limit on the clip size.
        const url = await uploadSceneFootageDirect({
          briefId,
          sceneIndex,
          file,
          contentType: file.type,
          onProgress: (f) =>
            toast.loading(`Uploading scene ${sceneIndex + 1}… ${Math.round(f * 100)}%`, { id }),
        });
        setFootage((m) => ({ ...m, [sceneIndex]: url }));
        // Remember the file the creator actually picked so the scene can show its name.
        setFilenames(setFootageName(briefId, sceneIndex, file.name));
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
        setFilenames(removeFootageName(briefId, sceneIndex));
        toast.success("Footage deleted");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [briefId],
  );

  const filmedCount = doc ? doc.scenes.filter((_, i) => footage[i]).length : 0;
  // An in-progress render should win over a stale renderUrl left from a prior render,
  // so this does NOT require renderUrl to be empty (a re-render clears it a beat later).
  const renderActive =
    !!renderStatus &&
    renderStatus !== "done" &&
    renderStatus !== "error";
  const RENDER_LABELS: Record<string, string> = {
    queued: "Queued…",
    transcribing: "Transcribing…",
    cutting: "Cutting…",
    planning: "Planning visuals…",
    rendering: "Rendering…",
    "quality-checking": "Checking quality…",
    uploading: "Uploading…",
  };
  const renderStatusLabel = renderStatus
    ? RENDER_LABELS[renderStatus] ?? "Working…"
    : "Working…";

  if ((!ready && !testMode) || (phase === "empty" && !doc)) {
    return (
      <div className="mx-auto w-full max-w-[920px] px-4 py-10 sm:px-8">
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
    <div className="mx-auto w-full max-w-[920px] px-4 py-10 sm:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <SectionMarker n="03" title="Content brief" />
        {phase === "brief" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPhase("questions")}>
              Edit answers & regenerate
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRecordScene(0)}>
              ● Record
            </Button>
            {renderActive ? (
              <Button
                size="sm"
                disabled
 title="Editing your video, this can take a few minutes. You can leave this page and come back; it'll keep going."
              >
                <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
                {renderStatusLabel}
              </Button>
            ) : renderUrl ? (
              <>
                <Button size="sm" onClick={() => setShowRender(true)}>
                  ▶ View edited video
                </Button>
                <Button size="sm" variant="outline" onClick={requestRender}>
                  Re-render
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={deleteRender}
                  disabled={deletingRender}
                  className="text-destructive hover:text-destructive"
                >
                  {deletingRender ? "Deleting…" : "Delete video"}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={requestRender}
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

      {renderActive && (
        <p className="mt-2 max-w-xl text-xs text-muted-foreground">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary align-middle" />
 Editing your video, this can take a few minutes. You can leave this page and
          come back; it&apos;ll keep going.
        </p>
      )}

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
          filenames={filenames}
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
          initialNames={filenames}
          onFootageChange={(sceneIndex, url, name) => {
            setFootage((m) => {
              const next = { ...m };
              if (url) next[sceneIndex] = url;
              else delete next[sceneIndex];
              return next;
            });
            setFilenames(
              url
                ? setFootageName(briefId, sceneIndex, name ?? "Recorded take")
                : removeFootageName(briefId, sceneIndex),
            );
          }}
          onClose={() => setRecordScene(null)}
        />
      )}

      <RenderConfirmDialog
        open={confirmRenderOpen}
        cost={renderCost}
        onOpenChange={setConfirmRenderOpen}
        onConfirm={() => {
          setConfirmRenderOpen(false);
          void sendToEditor();
        }}
      />

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
            <div className="aspect-[9/16] max-h-[80vh] w-auto max-w-[92vw] overflow-hidden rounded-[2rem] border-[5px] border-neutral-800 bg-black shadow-2xl">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={renderUrl}
                controls
                autoPlay
                playsInline
                className="h-full w-full bg-black object-contain"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={downloadVideo}
                disabled={downloadingRender}
                className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black transition hover:bg-white/90 disabled:opacity-60"
              >
                {downloadingRender ? "Downloading…" : "↓ Download MP4"}
              </button>
              <button
                onClick={deleteRender}
                disabled={deletingRender}
                className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white/80 backdrop-blur transition hover:bg-white/20 hover:text-white disabled:opacity-60"
              >
                {deletingRender ? "Deleting…" : "Delete video"}
              </button>
            </div>
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
 Answer what you can, anything you skip, I&apos;ll fill with a clearly-marked assumption.
      </p>

      <div className="mt-4 space-y-4">
        {gaps.length === 0 && (
 <p className="text-sm text-muted-foreground">No questions, you can draft straight away.</p>
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

// Inline confirmation strip for an attached clip: a poster-frame thumbnail (click to play
// full-size) plus the filename the creator picked, so they can tell one recording from the
// next without opening each one.
function FootagePreview({
  url,
  name,
  onOpen,
}: {
  url: string;
  name?: string;
  onOpen: () => void;
}) {
  const label = name ?? "Uploaded clip";
  // Browsers only decode web codecs (H.264/VP8/VP9/AV1). An uploaded .mov/HEVC fails to paint
  // the poster here even though it renders fine (the render box re-encodes with ffmpeg).
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Play this clip"
      className="group mt-3 flex w-full items-center gap-3 rounded-md border border-border bg-muted/50 p-2 text-left transition hover:border-primary/50 hover:bg-muted"
    >
      <span className="relative block aspect-[9/16] h-16 shrink-0 overflow-hidden rounded bg-black">
        {failed ? (
          <span className="flex h-full w-full items-center justify-center text-lg text-white/40">🎞</span>
        ) : (
          <>
            {/* Metadata-only poster frame; #t=0.1 nudges browsers to paint the first frame. */}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={`${url}#t=0.1`}
              muted
              playsInline
              preload="metadata"
              tabIndex={-1}
              aria-hidden
              onError={() => setFailed(true)}
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-sm text-white/90 transition group-hover:bg-black/35">
              ▶
            </span>
          </>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <Kicker>Your footage</Kicker>
        <span className="mt-1 block truncate font-mono text-xs text-foreground" title={label}>
          {label}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {failed
 ? "Format can't preview here, it'll still render fine"
 : "Tap to play, confirm it's the right clip"}
        </span>
      </span>
    </button>
  );
}

// Full-size playback for an attached clip. Same codec caveat as the poster: an uploaded .mov/HEVC
// won't play here (the render box re-encodes it), so on a decode error we show a clear note
// instead of a black box.
function FootageModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg text-white/80 backdrop-blur transition hover:bg-white/20 hover:text-white"
      >
        ✕
      </button>
      {/* Definite height, not max-h. Both children below are `absolute inset-0`, so this box
          has no in-flow content: with `max-h`/`w-auto` its height resolved to 0, and
          aspect-ratio then derived a width of 0 from it, collapsing the modal to its 5px
          border. Sized like the teleprompter's phone frame, which has always worked. */}
      <div
        className="relative z-10 aspect-[9/16] h-[50vh] max-w-[92vw] overflow-hidden rounded-[2rem] border-[5px] border-neutral-800 bg-black shadow-2xl lg:h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <span className="text-4xl">🎞</span>
            <p className="font-mono text-sm text-white/90">Can&apos;t preview this format in the browser.</p>
            <p className="font-mono text-[11px] text-white/50">
 It&apos;ll still render fine, proof re-encodes it during editing.
            </p>
          </div>
        ) : (
          /* eslint-disable-next-line jsx-a11y/media-has-caption */
          <video
            src={url}
            controls
            autoPlay
            playsInline
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        )}
      </div>
    </div>
  );
}

function BriefView({
  doc,
  footage,
  filenames,
  onRecord,
  onUpload,
  onDelete,
}: {
  doc: BriefDoc;
  footage: Record<number, string>;
  filenames: Record<number, string>;
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
          const clipName = filenames[i];
          return (
          <article
            key={i}
            className={`rounded-lg border bg-card p-4 ${
              clip ? "border-primary/40" : "border-border"
            }`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
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
              <div className="flex flex-wrap items-center gap-2">
                {s.durationSeconds ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    ~{s.durationSeconds}s
                  </span>
                ) : null}
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

            {clip && (
              <FootagePreview url={clip} name={clipName} onOpen={() => setViewUrl(clip)} />
            )}

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

      {viewUrl && <FootageModal url={viewUrl} onClose={() => setViewUrl(null)} />}
    </div>
  );
}

function BriefSkeleton() {
  return (
    <div className="mt-7" aria-busy="true" aria-label="Loading brief">
 {/* Hero card, mirrors the title / angle / hook block of the real brief */}
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
