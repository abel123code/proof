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
  const [repoUrl, setRepoUrl] = useState("");
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
    if (!repoUrl.trim()) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/analyze-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setProjects((prev) => [data.project, ...prev]);
      setSelectedProjectId(data.project.id);
      setRepoUrl("");
      toast.success(`Understood "${data.project.name}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[760px] px-8 py-10">
      <SectionMarker n="01" title="Connect a repo" />
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Paste a public GitHub repo. We pull the README, file tree, and languages, then
        understand what the project is and what is interesting about it.
      </p>

      <div className="mt-6 flex gap-2">
        <Input
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && analyzeRepo()}
          className="font-mono text-sm"
        />
        <Button onClick={analyzeRepo} disabled={analyzing || !repoUrl.trim()}>
          {analyzing ? "Analyzing..." : "Analyze"}
        </Button>
      </div>

      {projects.length > 0 && (
        <div className="mt-6">
          <Kicker>Your projects</Kicker>
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

          <NextStage from="/" />
        </div>
      )}

      {!selectedProject?.understanding && projects.length > 0 && (
        <div className="mt-8 border-t border-border pt-8">
          <Kicker>Pick a project</Kicker>
          <p className="mt-3 max-w-sm font-display text-xl leading-snug tracking-tight">
            Select one of your projects above to view its understanding.
          </p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Or paste another GitHub repo to analyze a new one.
          </p>
        </div>
      )}

      {!selectedProject?.understanding && projects.length === 0 && (
        <div className="mt-8 border-t border-border pt-8">
          <Kicker>Get started</Kicker>
          <p className="mt-3 max-w-sm font-display text-xl leading-snug tracking-tight">
            Paste a GitHub repo above to see what your project is really about.
          </p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            We read the README, file tree, and languages, then lay out the problem it
            solves, the stack, and the single most interesting thing about it - the raw
            material for your video.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setRepoUrl("https://github.com/vercel/ms")}
          >
            Try an example repo
          </Button>
        </div>
      )}
    </div>
  );
}
