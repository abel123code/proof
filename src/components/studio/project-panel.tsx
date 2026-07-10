"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker, SectionMarker } from "@/components/studio/primitives";
import { NextStage } from "@/components/studio/next-stage";
import { resolveHandle } from "@/components/studio/github-handle";
import { emitCreditsChanged } from "@/components/studio/credits";
import type { Project } from "@/lib/types";

interface PublicRepo {
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  pushedAt: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

export function ProjectPanel() {
  const [handle, setHandle] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  const [repos, setRepos] = useState<PublicRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [query, setQuery] = useState("");

  const [analyzingRepo, setAnalyzingRepo] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  // Repo URLs that already have a saved project, so we can offer "Open" (resume)
  // instead of re-analyzing from scratch.
  const [analyzedUrls, setAnalyzedUrls] = useState<Set<string>>(new Set());

  const loadRepos = useCallback(async (h: string) => {
    setLoadingRepos(true);
    try {
      const res = await fetch(`/api/github/repos?username=${encodeURIComponent(h)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load repos");
      setRepos(data.repos ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load repos");
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (!res.ok) return;
      const urls = new Set<string>(
        (data.projects ?? [])
          .filter((p: Project) => p.understanding)
          .map((p: Project) => p.repoUrl.toLowerCase()),
      );
      setAnalyzedUrls(urls);
    } catch {
      // non-fatal - repos just won't show the "analyzed" affordance
    }
  }, []);

  useEffect(() => {
    (async () => {
      const h = await resolveHandle();
      setHandle(h);
      setResolving(false);
      if (h) loadRepos(h);
    })();
    loadProjects();
  }, [loadRepos, loadProjects]);

  const analyzeRepo = useCallback(async (repo: PublicRepo) => {
    setAnalyzingRepo(repo.fullName);
    try {
      const res = await fetch("/api/analyze-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repo.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setProject(data.project);
      toast.success(`Analysed ${repo.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzingRepo(null);
      emitCreditsChanged();
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }, [repos, query]);

  return (
    <div className="mx-auto w-full max-w-[720px] px-8 py-10">
      <SectionMarker n="01" title="Pick a repo" />
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Choose the repo you want this video to be about. We scan its README, stack, and
        structure to build the credibility base for everything downstream.
      </p>

      {resolving ? (
        <div className="mt-6">
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ) : !handle ? (
        <div className="mt-6 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          Connect your GitHub first. Go to{" "}
          <Link href="/settings" className="text-foreground underline underline-offset-2">
            Settings
          </Link>{" "}
          and save your handle, then come back to pick a repo.
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-center justify-between">
            <Kicker>
              Repos for{" "}
              <a
                href={`https://github.com/${handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                @{handle}
              </a>
            </Kicker>
            <Link
              href="/settings"
              className="font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              change
            </Link>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border p-2">
              <Input
                placeholder="Search repos…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 border-0 bg-transparent font-mono text-sm shadow-none focus-visible:ring-0"
              />
            </div>

            {loadingRepos ? (
              <div className="divide-y divide-border">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="ml-auto h-7 w-20 rounded-md" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {repos.length === 0
                  ? `No public repos found for @${handle}.`
                  : "No repos match your search."}
              </p>
            ) : (
              <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
                {filtered.map((r) => {
                  const busy = analyzingRepo === r.fullName;
                  const analyzed = analyzedUrls.has(r.url.toLowerCase());
                  return (
                    <div
                      key={r.fullName}
                      className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-sm font-medium">
                            {r.name}
                          </span>
                          {analyzed && (
                            <Badge className="shrink-0 bg-primary/15 font-mono text-[10px] text-primary">
                              analyzed
                            </Badge>
                          )}
                          {r.language && (
                            <Badge
                              variant="secondary"
                              className="shrink-0 font-mono text-[10px]"
                            >
                              {r.language}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground/70">
                          {r.stars > 0 && <span>★ {r.stars}</span>}
                          <span>{timeAgo(r.pushedAt)}</span>
                          {r.description && (
                            <span className="truncate">· {r.description}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={analyzed ? "default" : "outline"}
                        className="h-7 shrink-0 px-3 text-xs"
                        onClick={() => analyzeRepo(r)}
                        disabled={!!analyzingRepo}
                      >
                        {busy ? (analyzed ? "Opening…" : "Analysing…") : analyzed ? "Open" : "Select"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {project?.understanding && (
        <div className="mt-8 border-t border-border pt-8">
          <Kicker>Project understanding</Kicker>
          <p className="mt-3 font-display text-3xl leading-tight tracking-tight">
            {project.understanding.oneLiner}
          </p>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            {project.understanding.summary}
          </p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {project.understanding.stack.map((s) => (
              <Badge key={s} variant="secondary" className="font-mono text-[11px]">
                {s}
              </Badge>
            ))}
          </div>

          <dl className="mt-6 space-y-4 text-sm">
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Problem
              </dt>
              <dd className="mt-1">{project.understanding.problem}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Most interesting
              </dt>
              <dd className="mt-1">{project.understanding.interesting}</dd>
            </div>
          </dl>

          <div className="mt-6">
            <Kicker>Talking points</Kicker>
            <ul className="mt-2 space-y-1.5">
              {project.understanding.talkingPoints.map((t, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="font-mono text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          <NextStage from="/connect" query={`?project=${project.id}`} />
        </div>
      )}
    </div>
  );
}
