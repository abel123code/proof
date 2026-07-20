"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Camera, ShieldCheck } from "lucide-react";
import { Teleprompter } from "@/components/studio/teleprompter";
import type { BriefDoc } from "@/lib/types";

const DEMO_DOC: BriefDoc = {
  title: "Turn a shipped project into a short video",
  hook: "Show what you built without writing the script yourself.",
  angle: "A quick, developer-first project pitch.",
  scenes: [
    {
      scene: 1,
      label: "Pitch your project",
      spokenLine:
        "I built a small tool that turns messy GitHub issues into a visual daily plan. It reads the issue, breaks the work into steps, and gives the team one place to track what ships next.",
      onScreenText: "From issue to daily plan",
      brollCue: "Face to camera. Keep it conversational.",
      durationSeconds: 15,
    },
  ],
  assumptions: [],
  sources: [],
};

export function LandingDemo() {
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const handleLocalRecording = useCallback((blob: Blob | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextUrl = blob ? URL.createObjectURL(blob) : null;
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
  }, []);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  return (
    <div id="demo" className="mt-14 max-w-3xl scroll-mt-24">
      <div className="mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
          Interactive demo · no account needed
        </p>
        <h3 className="mt-3 font-display text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
          Try the recording step yourself.
        </h3>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
          This is the same scene view you get inside Proof. We wrote the example, so you can
          jump straight into the teleprompter.
        </p>
      </div>

      <article
        className={`demo-scene-card rounded-lg border bg-card p-4 shadow-sm sm:p-5 ${
          previewUrl ? "border-primary/40" : "border-border"
        }`}
      >
        <div className="mb-5 rounded-lg border border-primary/20 bg-primary/[0.04] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
              {previewUrl ? "Demo complete" : "Just follow these steps"}
            </p>
            <span className="font-mono text-[10px] text-muted-foreground">takes about 30 sec</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ["1", "Start recording", "We open the teleprompter."],
              ["2", "Read the script", "Allow camera, then follow the words."],
              ["3", "Use your take", "Stop, preview, and continue."],
            ].map(([number, title, detail]) => (
              <div key={number} className="flex gap-2.5">
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] ${
                    previewUrl
                      ? "bg-primary text-primary-foreground"
                      : number === "1"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-background text-muted-foreground"
                  }`}
                >
                  {previewUrl ? "✓" : number}
                </span>
                <div>
                  <p className="text-sm font-medium leading-tight">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-xs text-primary">SCENE 01</span>
            <span className="font-display text-base tracking-tight">Pitch your project</span>
            <span
              className={`font-mono text-[10px] ${
                previewUrl ? "text-primary" : "text-muted-foreground/60"
              }`}
            >
              {previewUrl ? "filmed" : "no footage"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">~15s</span>
          </div>
        </div>

        {previewUrl && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-primary/25 bg-secondary/30 p-3">
            <video
              key={previewUrl}
              src={previewUrl}
              controls
              playsInline
              className="aspect-[9/16] h-24 shrink-0 rounded-md bg-black object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
                Your footage
              </p>
              <p className="mt-1 text-sm font-medium">Demo take</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Preview your clip here, or re-record it before continuing.
              </p>
              <button
                type="button"
                onClick={() => setRecorderOpen(true)}
                className="mt-2 cursor-pointer font-mono text-[10px] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                re-record this scene
              </button>
            </div>
          </div>
        )}

        <p className="mt-4 text-[15px] leading-relaxed">{DEMO_DOC.scenes[0].spokenLine}</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md bg-muted/50 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              On screen
            </p>
            <p className="mt-1 text-sm">{DEMO_DOC.scenes[0].onScreenText}</p>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Show / b-roll
            </p>
            <p className="mt-1 text-sm italic text-muted-foreground">
              {DEMO_DOC.scenes[0].brollCue}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex max-w-md items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <p>Your demo take stays in this browser tab and is never uploaded or saved.</p>
          </div>
          {previewUrl ? (
            <Link
              href="/login?next=%2Fconnect&source=demo"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 font-mono text-xs font-medium text-primary-foreground transition-all duration-200 hover:translate-x-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              send to editor <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setRecorderOpen(true)}
              className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 font-mono text-xs font-medium text-primary-foreground transition-all duration-200 hover:translate-x-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Camera className="size-4" aria-hidden />
              start guided recording
            </button>
          )}
        </div>
      </article>

      {recorderOpen && (
        <Teleprompter
          doc={DEMO_DOC}
          briefId={null}
          mode="local"
          maxRecordingSeconds={20}
          onLocalRecording={handleLocalRecording}
          onClose={() => setRecorderOpen(false)}
        />
      )}
    </div>
  );
}
