"use client";

import Link from "next/link";
import { ArrowRight, Camera } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
      // The demo script IS Proof's pitch. Reading it out loud is the fastest way to understand the
      // product, and it saves inventing a fake project the visitor has no reason to care about.
      // Kept distinct from the side-by-side example on the landing page: this one demonstrates the
      // mechanism, that one demonstrates the writing. Saying the same sentence twice on one page
      // makes the whole thing feel generated.
      spokenLine:
        "You point Proof at your GitHub repo. It reads the README, works out what's actually worth saying about the project, and writes you a script. You read it off this teleprompter in one take, and it cuts the video for you.",
      onScreenText: "Repo in. Video out.",
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

  if (recorderOpen) {
    return (
      <div id="demo" className="w-full scroll-mt-24">
        <h2 className="sr-only">Try the teleprompter</h2>
        <Teleprompter
          doc={DEMO_DOC}
          briefId={null}
          mode="local"
          presentation="inline"
          maxRecordingSeconds={20}
          onLocalRecording={handleLocalRecording}
          onClose={() => setRecorderOpen(false)}
        />
      </div>
    );
  }

  return (
    <div id="demo" className="w-full scroll-mt-24">
      <h2 className="sr-only">Try the teleprompter</h2>
      <div className="demo-scene-card overflow-hidden rounded-[1.75rem] border border-black/10 bg-[#2d2d2a] p-4 text-white shadow-[0_28px_70px_-36px_rgba(25,20,16,0.78)] sm:p-5">
        <div className="mx-auto max-w-[17rem]">
          <p className="mb-3 text-center font-mono text-[9px] text-white/45">
            Interactive teleprompter · no account
          </p>

          <div className="relative aspect-[9/16] overflow-hidden rounded-[2rem] border-[6px] border-[#151515] bg-black shadow-2xl">
            {previewUrl ? (
              <video
                key={previewUrl}
                src={previewUrl}
                controls
                playsInline
                className="absolute inset-0 h-full w-full bg-black object-contain"
              />
            ) : (
              <>
                <div className="absolute inset-x-0 top-0 h-[62%] overflow-hidden px-5 pt-8">
                  {/* Without this the demo reads as a plain webcam. The point is that the script was
                      written FOR you from a repo, so say so above the words being read. */}
                  <p className="mb-3 font-mono text-[10px] text-white/40">
                    script Proof wrote from a repo
                  </p>
                  <p className="text-xl font-semibold leading-[1.18] text-white sm:text-2xl">
                    {DEMO_DOC.scenes[0].spokenLine}
                  </p>
                  <div className="mt-4 space-y-1 text-[10px] leading-relaxed text-white/35">
                    <p>
                      <span className="font-mono text-white/25">
                        text ·{" "}
                      </span>
                      {DEMO_DOC.scenes[0].onScreenText}
                    </p>
                    <p className="italic">
                      <span className="font-mono not-italic text-white/25">
                        show ·{" "}
                      </span>
                      {DEMO_DOC.scenes[0].brollCue}
                    </p>
                  </div>
                </div>

                <div className="absolute inset-x-0 bottom-7 flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setRecorderOpen(true)}
                    aria-label="Start the inline teleprompter"
                    className="demo-invite flex size-16 cursor-pointer items-center justify-center rounded-full border-2 border-white/65 transition hover:scale-105 hover:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e0533d] focus-visible:ring-offset-4 focus-visible:ring-offset-black"
                  >
                    <span className="flex size-11 items-center justify-center rounded-full bg-[#e0533d]">
                      <Camera className="size-5" aria-hidden />
                    </span>
                  </button>
                  <p className="font-mono text-[9px] text-white/55">
                    tap to record · ~20s
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-4 text-center sm:flex-row sm:text-left">
          <div>
            <p className="font-mono text-[9px] text-[#ff735b]">
              {previewUrl ? "Your take" : "Camera starts after you tap"}
            </p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-white/55">
              {previewUrl
                ? "Recorded in this tab. Nothing was uploaded."
                : "Read one scene, record one take, and preview it here. Nothing leaves this tab."}
            </p>
          </div>

          {previewUrl && (
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setRecorderOpen(true)}
                className="cursor-pointer font-mono text-[10px] text-white/65 underline-offset-4 hover:text-white hover:underline"
              >
                re-record
              </button>
              <Link
                href="/login?next=%2Fconnect&source=demo"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#e0533d] px-4 py-2 font-mono text-[10px] font-medium text-white transition hover:bg-[#c8472f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                continue <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
