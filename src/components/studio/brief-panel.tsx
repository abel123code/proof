"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker, SectionMarker, formatCount } from "@/components/studio/primitives";
import { NextStage } from "@/components/studio/next-stage";
import type { Brief, ContentBrief, Project, ReferenceVideo } from "@/lib/types";

export function BriefPanel() {
  const searchParams = useSearchParams();
  const initialRef = searchParams.get("ref");
  const appliedInitial = useRef(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [videos, setVideos] = useState<ReferenceVideo[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(true);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Brief | null>(null);

  const readyProjects = useMemo(
    () => projects.filter((p) => p.understanding),
    [projects],
  );
  const analysed = useMemo(
    () => videos.filter((v) => v.status === "analyzed" && v.structure),
    [videos],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, vRes, bRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/reference-videos"),
        fetch("/api/brief"),
      ]);
      const [p, v, b] = await Promise.all([pRes.json(), vRes.json(), bRes.json()]);
      if (!pRes.ok) throw new Error(p.error ?? "Failed to load projects");
      if (!vRes.ok) throw new Error(v.error ?? "Failed to load videos");
      if (!bRes.ok) throw new Error(b.error ?? "Failed to load briefs");
      setProjects(p.projects);
      setVideos(v.videos);
      setBriefs(b.briefs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // After data loads, apply the deep-link reference (?ref=) once, and auto-select
  // the project if there's only one analysed candidate - so "Use in brief" lands
  // the user ready to generate.
  useEffect(() => {
    if (loading || appliedInitial.current) return;
    appliedInitial.current = true;
    if (initialRef && analysed.some((v) => v.id === initialRef)) {
      setReferenceId(initialRef);
    }
    if (readyProjects.length === 1) {
      setProjectId(readyProjects[0].id);
    }
  }, [loading, initialRef, analysed, readyProjects]);

  async function generate() {
    if (!projectId || !referenceId) return;
    setGenerating(true);
    setResult(null);
    toast.info("Writing the brief - blending your product with the reference structure.");
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, referenceVideoId: referenceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Brief generation failed");
      setResult(data.brief);
      setBriefs((prev) => [data.brief, ...prev]);
      toast.success("Brief ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Brief generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "project";
  const refLabel = (id: string | null) => {
    const v = id ? videos.find((x) => x.id === id) : null;
    return v ? `@${v.author ?? "unknown"}` : "reference";
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-8 py-10">
      <SectionMarker n="03" title="Content brief" />
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Pick a project and one analysed reference. We adapt that proven structure - hook,
        beats, pacing - to showcase your product, and hand you a filmable brief.
      </p>

      {loading && (
        <div className="mt-6 flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!loading && (readyProjects.length === 0 || analysed.length === 0) && (
        <div className="mt-6 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          {readyProjects.length === 0 && (
            <p>
              No analysed project yet. Go to <span className="text-foreground">01 Connect repo</span>{" "}
              and analyse a repo first.
            </p>
          )}
          {analysed.length === 0 && (
            <p className={readyProjects.length === 0 ? "mt-2" : ""}>
              No analysed reference yet. Go to{" "}
              <span className="text-foreground">02 Reference pool</span> and hit Analyse on a clip.
            </p>
          )}
        </div>
      )}

      {!loading && readyProjects.length > 0 && analysed.length > 0 && (
        <div className="mt-7 flex flex-col gap-6">
          <div>
            <Kicker>Project</Kicker>
            <div className="mt-2 flex flex-wrap gap-2">
              {readyProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProjectId(p.id === projectId ? null : p.id)}
                  className={`rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
                    p.id === projectId
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-foreground/30"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Kicker>Reference structure</Kicker>
            <div className="mt-2 flex flex-col gap-2">
              {analysed.map((v) => {
                const active = v.id === referenceId;
                return (
                  <button
                    key={v.id}
                    onClick={() => setReferenceId(active ? null : v.id)}
                    className={`rounded-md border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-foreground/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm">@{v.author ?? "unknown"}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatCount(v.views)} views
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {v.structure?.hook ?? v.caption ?? ""}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Button onClick={generate} disabled={!projectId || !referenceId || generating}>
              {generating ? "Writing brief..." : "Generate brief"}
            </Button>
          </div>
        </div>
      )}

      {result?.content && (
        <div className="mt-10 border-t border-border pt-8">
          <Kicker>
            New brief · {projectName(result.projectId)} × {refLabel(result.referenceVideoId)}
          </Kicker>
          <div className="mt-3">
            <BriefView brief={result.content} />
          </div>
          <NextStage from="/brief" />
        </div>
      )}

      {!loading && briefs.length > 0 && (
        <div className="mt-12">
          <Kicker>Previous briefs</Kicker>
          <div className="mt-3 flex flex-col gap-2">
            {briefs
              .filter((b) => b.id !== result?.id)
              .map((b) => (
                <PreviousBrief
                  key={b.id}
                  brief={b}
                  projectName={projectName(b.projectId)}
                  refLabel={refLabel(b.referenceVideoId)}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviousBrief({
  brief,
  projectName,
  refLabel,
}: {
  brief: Brief;
  projectName: string;
  refLabel: string;
}) {
  const [open, setOpen] = useState(false);
  if (!brief.content) return null;
  return (
    <article className="rounded-md border border-border bg-card p-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <p className="truncate font-display text-base tracking-tight">{brief.content.title}</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {projectName} × {refLabel}
          </p>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {open ? "Hide" : "View"}
        </span>
      </button>
      {open && (
        <div className="mt-4 border-t border-border pt-4">
          <BriefView brief={brief.content} />
        </div>
      )}
    </article>
  );
}

function BriefView({ brief }: { brief: ContentBrief }) {
  return (
    <div className="space-y-6 text-sm">
      <div>
        <p className="font-display text-2xl leading-tight tracking-tight">{brief.title}</p>
        <p className="mt-2 leading-relaxed text-muted-foreground">{brief.angle}</p>
      </div>

      <Field label="Target audience">{brief.targetAudience}</Field>

      <div className="rounded-md border-l-2 border-primary bg-secondary/40 p-4">
        <Kicker>Hook · first 3 seconds</Kicker>
        <p className="mt-1.5 font-display text-lg leading-snug tracking-tight">{brief.hook}</p>
      </div>

      <div>
        <Kicker>Beats</Kicker>
        <ol className="mt-2 flex flex-col gap-3">
          {brief.beats.map((b, i) => (
            <li key={i} className="rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-primary">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-mono text-xs uppercase tracking-wider">{b.beat}</span>
              </div>
              <p className="mt-2 leading-relaxed">{b.voiceover}</p>
              {b.onScreenText && (
                <div className="mt-2">
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    on-screen: {b.onScreenText}
                  </Badge>
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-mono uppercase tracking-wider">Show: </span>
                {b.action}
              </p>
            </li>
          ))}
        </ol>
      </div>

      <Field label="Call to action">{brief.cta}</Field>
      <Field label="Tone & pacing">{brief.toneAndPacing}</Field>

      <Separator />
      <blockquote className="border-l-2 border-primary pl-3 font-display text-base italic leading-snug">
        {brief.whyThisWorks}
      </blockquote>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Kicker>{label}</Kicker>
      <p className="mt-1 leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}
