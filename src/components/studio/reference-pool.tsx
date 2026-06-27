"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker, SectionMarker, formatCount } from "@/components/studio/primitives";
import { NextStage } from "@/components/studio/next-stage";
import type { ReferenceVideo } from "@/lib/types";

export function ReferencePool() {
  const [videos, setVideos] = useState<ReferenceVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [analysingId, setAnalysingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadVideos = useCallback(async () => {
    setLoadingVideos(true);
    try {
      const res = await fetch("/api/reference-videos");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load videos");
      setVideos(data.videos);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load videos");
    } finally {
      setLoadingVideos(false);
    }
  }, []);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  async function scrapePool() {
    setScraping(true);
    toast.info("Scraping TikTok via Apify - this runs several queries and can take a few minutes.");
    try {
      const res = await fetch("/api/scrape-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultsPerPage: 8 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scrape failed");
      toast.success(
        `Added ${data.inserted} new founder-story clips (${data.aboveFloor ?? 0} high-view of ${data.keptRelevant ?? 0} relevant)`,
      );
      await loadVideos();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scrape failed");
    } finally {
      setScraping(false);
    }
  }

  async function analyse(video: ReferenceVideo) {
    setAnalysingId(video.id);
    setVideos((prev) =>
      prev.map((v) => (v.id === video.id ? { ...v, status: "analyzing" } : v)),
    );
    toast.info("Reverse-engineering with Gemini - downloads the clip and analyses it (~1 min).");
    try {
      const res = await fetch("/api/reverse-engineer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceVideoId: video.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setVideos((prev) =>
        prev.map((v) =>
          v.id === video.id ? { ...v, status: "analyzed", structure: data.structure } : v,
        ),
      );
      setExpandedId(video.id);
      toast.success("Structure extracted");
    } catch (e) {
      setVideos((prev) =>
        prev.map((v) => (v.id === video.id ? { ...v, status: "error" } : v)),
      );
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalysingId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[760px] px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <SectionMarker n="02" title="Reference pool" />
        <Button variant="outline" size="sm" onClick={scrapePool} disabled={scraping}>
          {scraping ? "Scraping..." : "Scrape pool"}
        </Button>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {loadingVideos && (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        )}

        {!loadingVideos && videos.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Pool is empty. Hit <span className="text-foreground">Scrape pool</span> to populate it.
          </div>
        )}

        {videos.map((v) => (
          <article key={v.id} className="rounded-md border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm underline-offset-2 hover:text-primary hover:underline"
                  >
                    @{v.author ?? "unknown"}
                  </a>
                  {v.matchedQuery && (
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {v.matchedQuery}
                    </Badge>
                  )}
                </div>
                <a
                  href={v.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 line-clamp-2 block text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {v.caption ?? "(no caption)"}
                </a>
                <div className="mt-1.5 flex gap-3 font-mono text-[11px] text-muted-foreground">
                  <span>{formatCount(v.views)} views</span>
                  <span>{formatCount(v.likes)} likes</span>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {v.status === "analyzed" ? (
                  <>
                    <Button asChild size="sm">
                      <Link href={`/brief?ref=${v.id}`}>Use in brief →</Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
                    >
                      {expandedId === v.id ? "Hide" : "View structure"}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => analyse(v)}
                    disabled={analysingId === v.id || v.status === "analyzing"}
                  >
                    {v.status === "analyzing" || analysingId === v.id
                      ? "Analysing..."
                      : v.status === "error"
                        ? "Retry"
                        : "Analyse"}
                  </Button>
                )}
                <a
                  href={v.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                >
                  open on tiktok
                </a>
              </div>
            </div>

            {expandedId === v.id && v.structure && (
              <div className="mt-4 border-t border-border pt-4">
                <StructureView structure={v.structure} />
              </div>
            )}
          </article>
        ))}
      </div>

      {videos.some((v) => v.status === "analyzed") && <NextStage from="/pool" />}
    </div>
  );
}

function StructureView({ structure }: { structure: NonNullable<ReferenceVideo["structure"]> }) {
  return (
    <div className="space-y-4 text-sm">
      <Field label="Hook">{structure.hook}</Field>

      <div>
        <Kicker>Beats</Kicker>
        <ol className="mt-1.5 space-y-1">
          {structure.beats.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-mono text-primary">{String(i + 1).padStart(2, "0")}</span>
              <span>{b}</span>
            </li>
          ))}
        </ol>
      </div>

      <Field label="Pacing">{structure.pacing}</Field>

      <div>
        <Kicker>On-screen text</Kicker>
        <ul className="mt-1.5 space-y-1 font-mono text-xs">
          {structure.onScreenText.map((o, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-primary">{o.atSeconds.toFixed(0)}s</span>
              <span className="text-muted-foreground">{o.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <Field label="What was said">{structure.spoken}</Field>

      <div>
        <Kicker>What was done</Kicker>
        <ul className="mt-1.5 list-inside list-disc space-y-1 text-muted-foreground">
          {structure.visualTechnique.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>

      <Separator />
      <blockquote className="border-l-2 border-primary pl-3 font-display text-base italic leading-snug">
        {structure.whyItWorks}
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
