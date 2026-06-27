"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker, SectionMarker } from "@/components/studio/primitives";
import type { Project, TrendResearch } from "@/lib/types";

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Demo mode is on when a pre-rendered MP4 is configured for the brief stage.
const DEMO_MODE = !!process.env.NEXT_PUBLIC_DEMO_RENDER_URL;
// The only trend with a prepared end-to-end output (the 5th card, 0-based index 4).
const DEMO_TREND_INDEX = 4;

export function TrendsPanel() {
  const searchParams = useSearchParams();
  const initialProject = searchParams.get("project");
  const appliedInitial = useRef(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  const [selectedTrend, setSelectedTrend] = useState<number | null>(null);
  const [showDemoNote, setShowDemoNote] = useState(DEMO_MODE);

  const readyProjects = useMemo(() => projects.filter((p) => p.understanding), [projects]);
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );
  const research = selectedProject?.trendResearch ?? null;
  const hasResearch = !!research && research.trends.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load projects");
      setProjects(data.projects);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loading || appliedInitial.current) return;
    appliedInitial.current = true;
    if (initialProject && readyProjects.some((p) => p.id === initialProject)) {
      setProjectId(initialProject);
    } else if (readyProjects.length === 1) {
      setProjectId(readyProjects[0].id);
    }
  }, [loading, initialProject, readyProjects]);

  // Reset the picked trend whenever the builder changes.
  useEffect(() => {
    setSelectedTrend(null);
  }, [projectId]);

  async function runResearch() {
    if (!projectId) return;
    setResearching(true);
    setSelectedTrend(null);
    toast.info("Exa is researching what's trending right now - reasoning over the web.");
    try {
      const res = await fetch("/api/research-trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Research failed");
      const tr: TrendResearch = data.trendResearch;
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, trendResearch: tr, trendResearchUpdatedAt: data.updatedAt }
            : p,
        ),
      );
      toast.success(`Found ${tr.trends.length} trends with sources`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Research failed");
    } finally {
      setResearching(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] px-8 py-10">
      {showDemoNote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowDemoNote(false)}
        >
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" />
          <div
            className="relative z-10 w-full max-w-3xl rounded-3xl border border-border bg-card p-10 text-center shadow-2xl sm:p-14"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="font-mono text-sm uppercase tracking-[0.3em] text-primary">
              Demo mode
            </span>
            <p className="mt-5 font-display text-6xl font-medium leading-[0.95] tracking-tight sm:text-8xl">
              Pick the{" "}
              <span className="text-primary">5th</span>
              <br />
              trend
            </p>
            <p className="mt-6 font-display text-2xl tracking-tight text-foreground/80 sm:text-3xl">
              “Build in public”
            </p>
            <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
              It&apos;s the <span className="font-medium text-foreground">only</span> trend with
              a prepared end-to-end output. The others won&apos;t produce a finished video.
            </p>
            <div className="mt-8 flex justify-center">
              <Button size="lg" className="px-8" onClick={() => setShowDemoNote(false)}>
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}

      <SectionMarker n="02" title="What's trending" />
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        Exa reasons over the web - Reddit, Hacker News, X - to find what builders are
        talking about right now, with real sources. Pick the one you want to ride.
      </p>

      {loading && (
        <div className="mt-6 flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {!loading && readyProjects.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          No connected builder yet. Go to{" "}
          <Link href="/connect" className="text-foreground underline underline-offset-2">
            01 Connect GitHub
          </Link>{" "}
          and build a profile first.
        </div>
      )}

      {!loading && readyProjects.length > 0 && (
        <>
          <div className="mt-7">
            <Kicker>Builder</Kicker>
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

          {projectId && (
            <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/30 p-4">
              <div>
                <Kicker>Trend research · Exa</Kicker>
                {hasResearch && selectedProject?.trendResearchUpdatedAt && (
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    last researched {timeAgo(selectedProject.trendResearchUpdatedAt)}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant={hasResearch ? "outline" : "default"}
                onClick={runResearch}
                disabled={researching}
              >
                {researching ? "Researching..." : hasResearch ? "Re-research" : "Research now"}
              </Button>
            </div>
          )}

          {researching && !hasResearch && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-36 w-full" />
            </div>
          )}

          {hasResearch && (
            <div className="mt-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {research!.trends.map((t, i) => {
                  const active = i === selectedTrend;
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        if (DEMO_MODE && i !== DEMO_TREND_INDEX) {
                          setShowDemoNote(true);
                          return;
                        }
                        setSelectedTrend(active ? null : i);
                      }}
                      className={`flex flex-col rounded-lg border p-4 text-left transition-colors ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border bg-card hover:border-foreground/30"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="font-mono text-primary">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <p className="font-display text-lg leading-snug tracking-tight">
                          {t.topic}
                        </p>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{t.whyTrending}</p>
                      <p className="mt-2 text-sm italic text-foreground/80">
                        Angle: {t.suggestedAngle}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {t.whereDiscussed}
                        </Badge>
                        {t.sourceUrls.map((u) => (
                          <a
                            key={u}
                            href={u}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-[10px] text-primary underline-offset-2 hover:underline"
                          >
                            {hostOf(u)} ↗
                          </a>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-8 flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Up next · 03
                  </span>
                  <p className="mt-1 font-display text-lg leading-snug tracking-tight">
                    {selectedTrend != null
                      ? `Find clips on "${research!.trends[selectedTrend].topic}"`
                      : "Clips"}
                  </p>
                  <p className="mt-0.5 max-w-md text-sm text-muted-foreground">
                    {selectedTrend != null
                      ? "See what's already winning on TikTok for this topic."
                      : "Pick a trend above to continue."}
                  </p>
                </div>
                {selectedTrend != null ? (
                  <Button asChild className="shrink-0">
                    <Link href={`/clips?project=${projectId}&trend=${selectedTrend}`}>
                      Continue →
                    </Link>
                  </Button>
                ) : (
                  <Button disabled className="shrink-0">
                    Continue →
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
