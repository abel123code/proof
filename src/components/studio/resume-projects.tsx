"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/studio/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { setActiveProject } from "@/components/studio/active-project";
import type { ProjectProgress } from "@/lib/resume";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

const PAGE_SIZE = 2;

export function ResumeProjects() {
  const [projects, setProjects] = useState<ProjectProgress[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects/overview");
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setProjects(data.projects ?? []);
      } catch {
        // non-fatal - the repo picker below is always available
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="mb-10">
        <Kicker>Continue where you left off</Kicker>
        <div className="mt-3 space-y-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!projects || projects.length === 0) return null;

  const pageCount = Math.ceil(projects.length / PAGE_SIZE);
  const safePage = Math.min(page, pageCount - 1);
  const visible = projects.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between">
        <Kicker>Continue where you left off</Kicker>
        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {safePage + 1}/{pageCount}
            </span>
            <button
              type="button"
              aria-label="Previous"
              onClick={() => setPage((p) => (p - 1 + pageCount) % pageCount)}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              ←
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => setPage((p) => (p + 1) % pageCount)}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              →
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
        {visible.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 bg-card/40 px-4 py-3 transition-colors hover:bg-secondary/50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-sm font-medium">{p.name}</span>
                <Badge
                  variant={p.hasRender ? "default" : "secondary"}
                  className={`shrink-0 font-mono text-[10px] ${
                    p.hasRender ? "bg-primary/15 text-primary" : ""
                  }`}
                >
                  {p.label}
                </Badge>
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                {timeAgo(p.lastActivity)}
              </div>
            </div>
            <Button asChild size="sm" variant="outline" className="h-7 shrink-0 px-3 text-xs">
              <Link
                href={p.href}
                onClick={() => setActiveProject({ id: p.id, name: p.name })}
              >
                Continue →
              </Link>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
