"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Kicker, SectionMarker } from "@/components/studio/primitives";
import { NextStage } from "@/components/studio/next-stage";
import type { Project } from "@/lib/types";

export function ProjectPanel() {
  const [username, setUsername] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load projects");
      setProjects(data.projects);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load projects");
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  async function analyzeRepo() {
    if (!username.trim()) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/analyze-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setProjects((prev) => [data.project, ...prev]);
      setSelectedProjectId(data.project.id);
      setUsername("");
      toast.success(`Built profile for @${data.project.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[760px] px-8 py-10">
      <SectionMarker n="01" title="Connect GitHub" />
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Enter a GitHub username. We scan their public repos and recent activity, then
        build a profile of what this person actually ships - the credibility base for
        everything downstream.
      </p>

      <div className="mt-6 flex gap-2">
        <Input
          placeholder="github username (e.g. torvalds)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && analyzeRepo()}
          className="font-mono text-sm"
        />
        <Button onClick={analyzeRepo} disabled={analyzing || !username.trim()}>
          {analyzing ? "Building..." : "Connect"}
        </Button>
      </div>

      {projects.length > 0 && (
        <div className="mt-6">
          <Kicker>Your builders</Kicker>
          <div className="mt-2 flex flex-wrap gap-2">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() =>
                  setSelectedProjectId(p.id === selectedProjectId ? null : p.id)
                }
                className={`rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
                  p.id === selectedProjectId
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/30"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedProject?.understanding && (
        <div className="mt-8 border-t border-border pt-8">
          <Kicker>Project understanding</Kicker>
          <p className="mt-3 font-display text-3xl leading-tight tracking-tight">
            {selectedProject.understanding.oneLiner}
          </p>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            {selectedProject.understanding.summary}
          </p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {selectedProject.understanding.stack.map((s) => (
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
              <dd className="mt-1">{selectedProject.understanding.problem}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Most interesting
              </dt>
              <dd className="mt-1">{selectedProject.understanding.interesting}</dd>
            </div>
          </dl>

          <div className="mt-6">
            <Kicker>Talking points</Kicker>
            <ul className="mt-2 space-y-1.5">
              {selectedProject.understanding.talkingPoints.map((t, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="font-mono text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          {selectedProject.understanding.notableRepos?.length > 0 && (
            <div className="mt-6">
              <Kicker>Notable repos</Kicker>
              <div className="mt-2 flex flex-col gap-2">
                {selectedProject.understanding.notableRepos.map((r) => (
                  <a
                    key={r.url}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-border p-3 transition-colors hover:border-foreground/30"
                  >
                    <span className="font-mono text-sm text-primary underline-offset-2 hover:underline">
                      {r.name}
                    </span>
                    {r.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          <NextStage
            from="/connect"
            query={selectedProjectId ? `?project=${selectedProjectId}` : undefined}
          />
        </div>
      )}

      {!selectedProject?.understanding && projects.length > 0 && (
        <div className="mt-8 border-t border-border pt-8">
          <Kicker>Pick a builder</Kicker>
          <p className="mt-3 max-w-sm font-display text-xl leading-snug tracking-tight">
            Select one of your builders above to view its profile.
          </p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Or enter another GitHub username to build a new profile.
          </p>
        </div>
      )}

      {!selectedProject?.understanding && projects.length === 0 && (
        <div className="mt-8 border-t border-border pt-8">
          <Kicker>Get started</Kicker>
          <p className="mt-3 max-w-sm font-display text-xl leading-snug tracking-tight">
            Enter a GitHub username above to see what they really build.
          </p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            We scan their most active public repos and READMEs, then lay out what they
            ship, their stack, and the single most impressive thing about their work -
            the credibility base for your content.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setUsername("torvalds")}
          >
            Try an example
          </Button>
        </div>
      )}
    </div>
  );
}
