"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Kicker, SectionMarker } from "@/components/studio/primitives";
import { NextStage } from "@/components/studio/next-stage";
import { resolveHandle } from "@/components/studio/github-handle";
import { emitCreditsChanged } from "@/components/studio/credits";
import { setActiveProject } from "@/components/studio/active-project";
import { ResumeProjects } from "@/components/studio/resume-projects";
import {
  getCachedRepos,
  setCachedRepos,
  type PublicRepo,
} from "@/components/studio/profile-store";
import type { Project } from "@/lib/types";
import { emitOnboardingAction } from "@/components/studio/onboarding-events";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

/** A picker row: a public repo, or a private one granted via the GitHub App installation. */
type PickerRepo = PublicRepo & { isPrivate?: boolean };

/** Whether private-repo support is deployed, and whether this user connected it. */
interface GithubAppState {
  available: boolean;
  connected: boolean;
  privateCount: number;
  error: string | null;
}

export function ProjectPanel() {
  const [handle, setHandle] = useState<string | null>(null);
  // Lets the post-install effect refresh the picker without depending on `handle` state.
  const handleRef = useRef<string | null>(null);
  const [resolving, setResolving] = useState(true);

  const [repos, setRepos] = useState<PickerRepo[]>([]);
  const [githubApp, setGithubApp] = useState<GithubAppState | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [query, setQuery] = useState("");

  const [analyzingRepo, setAnalyzingRepo] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  // Repo URLs that already have a saved project, so we can offer "Open" (resume)
  // instead of re-analyzing from scratch.
  const [analyzedUrls, setAnalyzedUrls] = useState<Set<string>>(new Set());

  // `force` bypasses the cache: right after connecting an installation the cached list is stale
  // (it has no private repos), so the user would connect and see nothing change.
  const loadRepos = useCallback(async (h: string, force = false) => {
    // Serve from cache instantly on revisits; only hit GitHub on a cold handle.
    const cached = force ? null : getCachedRepos(h);
    if (cached) {
      setRepos(cached);
      return;
    }
    setLoadingRepos(true);
    try {
      const res = await fetch(`/api/github/repos?username=${encodeURIComponent(h)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load repos");
      const list: PickerRepo[] = data.repos ?? [];
      setRepos(list);
      setGithubApp(data.githubApp ?? null);
      setCachedRepos(h, list);
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
      handleRef.current = h;
      setResolving(false);
      if (h) loadRepos(h);
    })();
    loadProjects();
  }, [loadRepos, loadProjects]);

  // GitHub sends the user here after an install. Two shapes arrive:
  //  - ?github=connected|... : our own callback finished and is reporting the outcome
  //  - ?installation_id=N    : the user installed straight from github.com/apps/<slug>, so GitHub
  //    used the app's setup URL and our callback never ran. Forward it so the id is actually saved,
  //    otherwise they have installed but Proof would show "not connected" forever.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const installationId = params.get("installation_id");
    const status = params.get("github");

    if (installationId && !status) {
      window.location.replace(`/api/github/callback?installation_id=${encodeURIComponent(installationId)}`);
      return;
    }
    if (!status) return;

    const messages: Record<string, [("success" | "error"), string]> = {
      connected: ["success", "Private repos connected."],
      state_invalid: ["error", "That connect link expired. Try again from this page."],
      missing_installation: ["error", "GitHub did not send an installation. Try again."],
      set_handle_first: ["error", "Save your GitHub handle in Settings first, then reconnect."],
      owner_mismatch: [
        "error",
        "That installation belongs to a different GitHub account than the handle on your profile.",
      ],
    };
    const entry = messages[status];
    if (entry) toast[entry[0]](entry[1]);
    // Clean the URL so a refresh doesn't re-toast.
    window.history.replaceState({}, "", window.location.pathname);
    if (status === "connected" && handleRef.current) loadRepos(handleRef.current, true);
  }, [loadRepos]);

    const disconnectGithub = useCallback(async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/github/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Could not disconnect");
      setGithubApp((prev) => (prev ? { ...prev, connected: false, privateCount: 0 } : prev));
      setRepos((prev) => prev.filter((r) => !r.isPrivate));
      toast.success("Disconnected. Remove the app in GitHub settings to fully revoke access.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not disconnect");
    } finally {
      setDisconnecting(false);
    }
  }, []);

  const analyzeRepo = useCallback(async (repo: PickerRepo) => {
    setAnalyzingRepo(repo.fullName);
    emitOnboardingAction("repo-selected");
    try {
      const res = await fetch("/api/analyze-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repo.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      // e.g. "no README, so Proof had little to work from". Without this the user assumes the repo
      // connection failed, when the real cause is simply that there is nothing to read.
      if (data.warning) toast.warning(data.warning, { duration: 8000 });
      setProject(data.project);
      if (data.project?.id) {
        setActiveProject({ id: data.project.id, name: data.project.name ?? repo.name });
      }
      toast.success(`Analysed ${repo.name}`);
      emitOnboardingAction("repo-analyzed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
      emitOnboardingAction("repo-analysis-failed");
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
    <div className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-8">
      <ResumeProjects />
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

          {githubApp?.available && (
            <div className="mt-3 rounded-lg border border-border bg-secondary/30 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {githubApp.connected ? "Private repos connected" : "Private repos"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {githubApp.connected
                      ? `${githubApp.privateCount} private ${
                          githubApp.privateCount === 1 ? "repo" : "repos"
                        } shared with Proof. You choose which ones in GitHub.`
                      : "Working on something private? Pick the exact repos Proof can see."}
                  </p>
                </div>
                {githubApp.connected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={disconnectGithub}
                    disabled={disconnecting}
                    className="h-8 shrink-0 px-3 text-xs"
                  >
                    {disconnecting ? "Disconnecting..." : "Disconnect"}
                  </Button>
                ) : (
                  <Button asChild size="sm" className="h-8 shrink-0 px-3 text-xs">
                    <a href="/api/github/install">Connect private repos</a>
                  </Button>
                )}
              </div>
              {/* The privacy claim is the feature. It is true of fetchRepoSnapshot: README,
                  language stats and file PATHS only, never source file contents. */}
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground/70">
 Proof reads your <span className="text-foreground">README</span>, that is what the
 script is built from, plus file names and language stats. It never reads your source
                code, so a repo with no README has almost nothing to work from. Access is scoped to
                the repos you pick and you can revoke it any time in GitHub settings.
              </p>
              {githubApp.error && (
                <p className="mt-2 font-mono text-[10px] text-destructive">{githubApp.error}</p>
              )}
            </div>
          )}

          <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border p-2">
              <Input
                data-tour="repo-search"
                placeholder="Search repos…"
                value={query}
                onChange={(e) => {
                  const value = e.target.value;
                  setQuery(value);
                  const normalized = value.trim().toLowerCase();
                  const hasMatch = repos.some(
                    (repo) =>
                      repo.name.toLowerCase().includes(normalized) ||
                      (repo.description?.toLowerCase().includes(normalized) ?? false),
                  );
                  if (normalized && hasMatch) emitOnboardingAction("repo-searched");
                }}
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
                  ? `No repos found for @${handle}.`
                  : "No repos match your search."}
              </p>
            ) : (
              <div
                className="max-h-[420px] divide-y divide-border overflow-y-auto"
                data-tour="repo-list"
              >
                {filtered.map((r, index) => {
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
                          {r.isPrivate && (
                            <Badge
                              variant="outline"
                              className="shrink-0 border-primary/40 font-mono text-[10px] text-primary"
                            >
                              private
                            </Badge>
                          )}
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
                        data-tour={index === 0 ? "repo-select" : undefined}
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
          <p className="mt-3 font-display text-2xl leading-tight tracking-tight sm:text-3xl">
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
              <dt className="font-mono text-[11px] text-muted-foreground">
                Problem
              </dt>
              <dd className="mt-1">{project.understanding.problem}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] text-muted-foreground">
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
