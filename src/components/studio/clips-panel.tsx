"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Kicker, SectionMarker, formatCount } from "@/components/studio/primitives";
import { DemoBanner } from "@/components/studio/demo-hint";
import type { Project, ReferenceVideo } from "@/lib/types";

// Demo mode is on when a pre-rendered MP4 is configured for the brief stage.
const DEMO_MODE = !!process.env.NEXT_PUBLIC_DEMO_RENDER_URL;
// The prepared clip for the demo is the 2nd tile (0-based index 1).
const DEMO_CLIP_INDEX = 1;

export function ClipsPanel() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const trendIndex = searchParams.get("trend");

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [videos, setVideos] = useState<ReferenceVideo[]>([]);
  const [scraping, setScraping] = useState(false);
  const [analysingId, setAnalysingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seedTerms, setSeedTerms] = useState<string[]>([]);
  const autoAttempted = useRef<Set<string>>(new Set());

  const trend = useMemo(() => {
    if (!project?.trendResearch || trendIndex == null) return null;
    return project.trendResearch.trends[Number(trendIndex)] ?? null;
  }, [project, trendIndex]);
  const topic = trend?.topic ?? null;
  const selected = useMemo(
    () => videos.find((v) => v.id === selectedId) ?? null,
    [videos, selectedId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load projects");
      const p: Project | undefined = data.projects.find((x: Project) => x.id === projectId);
      setProject(p ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Load any clips already pulled for this topic, and auto-search if there are none yet.
  useEffect(() => {
    if (!topic) return;
    let cancelled = false;
    fetch(`/api/reference-videos?query=${encodeURIComponent(topic)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const existing: ReferenceVideo[] = d.videos ?? [];
        setVideos(existing);
        if (existing.length === 0 && !autoAttempted.current.has(topic)) {
          autoAttempted.current.add(topic);
          findClips();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  async function findClips() {
    if (!topic) return;
    setScraping(true);
    toast.info("Turning the trend into search terms, then searching TikTok and ranking by views.");
    try {
      const context = trend
        ? [trend.whyTrending, trend.suggestedAngle].filter(Boolean).join(" ")
        : undefined;
      const res = await fetch("/api/scrape-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, context }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scrape failed");
      setVideos(data.clips ?? []);
      setSeedTerms(Array.isArray(data.searchTerms) ? data.searchTerms : []);
      toast.success(`Found ${data.clips?.length ?? 0} clips`);
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
      toast.success("Structure extracted - use it in your script");
    } catch (e) {
      setVideos((prev) =>
        prev.map((v) => (v.id === video.id ? { ...v, status: "error" } : v)),
      );
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalysingId(null);
    }
  }

  const scriptHref = (videoId: string) =>
    `/brief?project=${projectId}&trend=${trendIndex}&ref=${videoId}`;

  if (!loading && (!projectId || trendIndex == null)) {
    return (
      <div className="mx-auto w-full max-w-[1000px] px-8 py-10">
        <SectionMarker n="03" title="Clips" />
        <div className="mt-6 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          Pick a trend first. Go to{" "}
          <Link href="/trends" className="text-foreground underline underline-offset-2">
            02 Trends
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <SectionMarker n="03" title="What's working" />
        <Button variant="outline" size="sm" onClick={findClips} disabled={scraping || !topic}>
          {scraping ? "Searching..." : videos.length > 0 ? "Refresh clips" : "Find clips"}
        </Button>
      </div>

      {topic && (
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Top TikToks already performing on{" "}
          <span className="font-medium text-foreground">{topic}</span>. Pick one, analyse its
          structure, and we&apos;ll use that proven shape in your script.
        </p>
      )}

      {DEMO_MODE && (
        <DemoBanner>
          Pick the <span className="text-primary">2nd</span> clip — it&apos;s already analysed and
          wired for the demo.
        </DemoBanner>
      )}

      {scraping && (
        <div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          <span className="text-muted-foreground">
            Searching TikTok for clips on this topic and ranking by views — this takes ~30s.
          </span>
        </div>
      )}

      {seedTerms.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            searched
          </span>
          {seedTerms.map((t) => (
            <Badge key={t} variant="secondary" className="font-mono text-[10px]">
              {t}
            </Badge>
          ))}
        </div>
      )}

      {loading && (
        <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[9/16] w-full rounded-md" />
          ))}
        </div>
      )}

      {!loading && videos.length === 0 && !scraping && (
        <div className="mt-6 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No clips found for this topic yet. Hit{" "}
          <span className="text-foreground">Find clips</span> to search TikTok again.
        </div>
      )}

      {scraping && videos.length === 0 && (
        <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[9/16] w-full rounded-md" />
          ))}
        </div>
      )}

      {videos.length > 0 && (
        <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {videos.map((v, i) => (
            <ClipTile
              key={v.id}
              video={v}
              selected={selectedId === v.id}
              recommended={DEMO_MODE && i === DEMO_CLIP_INDEX}
              busy={analysingId === v.id}
              scriptHref={scriptHref(v.id)}
              onSelect={() => setSelectedId(selectedId === v.id ? null : v.id)}
              onAnalyse={() => analyse(v)}
            />
          ))}
        </div>
      )}

      {selected && (
        <ClipDetail
          video={selected}
          busy={analysingId === selected.id}
          expanded={expandedId === selected.id}
          onAnalyse={() => analyse(selected)}
          onToggleStructure={() =>
            setExpandedId(expandedId === selected.id ? null : selected.id)
          }
          scriptHref={scriptHref(selected.id)}
        />
      )}
    </div>
  );
}

function ClipTile({
  video: v,
  selected,
  recommended,
  busy,
  scriptHref,
  onSelect,
  onAnalyse,
}: {
  video: ReferenceVideo;
  selected: boolean;
  recommended?: boolean;
  busy: boolean;
  scriptHref: string;
  onSelect: () => void;
  onAnalyse: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = v.thumbnailUrl && !imgFailed;
  const analysing = busy || v.status === "analyzing";
  return (
    <div
      onClick={onSelect}
      className={`group relative aspect-[9/16] w-full cursor-pointer overflow-hidden rounded-md border bg-muted text-left transition ${
        selected
          ? "border-primary ring-2 ring-primary"
          : recommended
            ? "border-primary ring-2 ring-primary/50"
            : "border-border hover:border-foreground/40"
      }`}
    >
      {recommended && !selected && (
        <span className="absolute right-1 top-1 z-10 rounded-full bg-primary px-1.5 py-0.5 font-mono text-[8px] font-medium uppercase tracking-wider text-primary-foreground">
          pick me
        </span>
      )}
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={v.thumbnailUrl ?? undefined}
          alt={v.caption ?? "TikTok clip"}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-background p-2 text-center">
          <span className="line-clamp-4 text-[11px] text-muted-foreground">
            {v.caption ?? "(no preview)"}
          </span>
        </div>
      )}

      {/* Hover actions: Open + Analyse / Use this */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/55 px-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <a
          href={v.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-full rounded bg-white/90 py-1 text-center text-[11px] font-medium text-black transition hover:bg-white"
        >
          Open ↗
        </a>
        {v.status === "analyzed" ? (
          <Link
            href={scriptHref}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded bg-primary py-1 text-center text-[11px] font-medium text-primary-foreground transition hover:opacity-90"
          >
            Use this →
          </Link>
        ) : (
          <button
            type="button"
            disabled={analysing}
            onClick={(e) => {
              e.stopPropagation();
              onAnalyse();
            }}
            className="w-full rounded bg-primary py-1 text-center text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {analysing ? "Analysing..." : v.status === "error" ? "Retry" : "Analyse"}
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
        <div className="flex items-center gap-1 font-mono text-[11px] font-medium text-white">
          <PlayIcon />
          {formatCount(v.views)}
        </div>
        <div className="truncate font-mono text-[9px] text-white/80">
          @{v.author ?? "unknown"}
        </div>
      </div>

      {v.status === "analyzed" && (
        <Badge className="absolute left-1 top-1 bg-primary text-[8px] text-primary-foreground">
          analysed
        </Badge>
      )}
    </div>
  );
}

function ClipDetail({
  video: v,
  busy,
  expanded,
  onAnalyse,
  onToggleStructure,
  scriptHref,
}: {
  video: ReferenceVideo;
  busy: boolean;
  expanded: boolean;
  onAnalyse: () => void;
  onToggleStructure: () => void;
  scriptHref: string;
}) {
  return (
    <article className="mt-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={v.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm underline-offset-2 hover:text-primary hover:underline"
          >
            @{v.author ?? "unknown"} ↗
          </a>
          <p className="mt-1 text-sm text-muted-foreground">{v.caption ?? "(no caption)"}</p>
          <div className="mt-1.5 flex gap-3 font-mono text-[11px] text-muted-foreground">
            <span>{formatCount(v.views)} views</span>
            <span>{formatCount(v.likes)} likes</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {v.status === "analyzed" ? (
            <>
              <Button asChild size="sm">
                <Link href={scriptHref}>Use this →</Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={onToggleStructure}>
                {expanded ? "Hide" : "View structure"}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={onAnalyse} disabled={busy || v.status === "analyzing"}>
              {busy || v.status === "analyzing"
                ? "Analysing..."
                : v.status === "error"
                  ? "Retry"
                  : "Analyse"}
            </Button>
          )}
        </div>
      </div>

      {expanded && v.structure && (
        <div className="mt-4 border-t border-border pt-4">
          <StructureView structure={v.structure} />
        </div>
      )}
    </article>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
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
      <Field label="What was said">{structure.spoken}</Field>
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
