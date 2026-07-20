"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { BriefDoc } from "@/lib/types";
import { uploadSceneFootageDirect } from "@/lib/upload";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAppleWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iOS (any browser is WebKit) or desktop Safari. Exclude Chrome/Edge on other platforms.
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
  const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
  return iOS || safari;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  // Safari/iOS only encodes mp4; Chromium/Firefox prefer webm. Order by platform,
  // then fall back to the browser default ("") so start() never throws on the type.
  const webm = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  const mp4 = ["video/mp4;codecs=h264,aac", "video/mp4"];
  const types = isAppleWebKit() ? [...mp4, ...webm] : [...webm, ...mp4];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function Teleprompter({
  doc,
  briefId,
  startScene = 0,
  initialFootage = {},
  initialNames = {},
  mode = "persisted",
  maxRecordingSeconds,
  onFootageChange,
  onLocalRecording,
  onClose,
}: {
  doc: BriefDoc;
  briefId: string | null;
  startScene?: number;
  initialFootage?: Record<number, string>;
  initialNames?: Record<number, string>;
  mode?: "persisted" | "local";
  maxRecordingSeconds?: number;
  onFootageChange?: (sceneIndex: number, url: string | null, name?: string) => void;
  onLocalRecording?: (blob: Blob | null) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRafRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const localUrlsRef = useRef<Record<number, string>>({});
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const playingRef = useRef(false);

  const sceneCount = doc.scenes.length;
  const [active, setActive] = useState(Math.min(Math.max(0, startScene), sceneCount - 1));
  const [camError, setCamError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [speed, setSpeed] = useState(5);
  const [fontScale, setFontScale] = useState(1);
  const [mirror, setMirror] = useState(false);
  // Persistent footage per scene index (public Storage URLs), seeded from the brief.
  const [footage, setFootage] = useState<Record<number, string>>(initialFootage);
  // An uploaded .mov/HEVC take won't decode in a browser <video> (it renders fine — the box
  // re-encodes it), so we swap the black box for a note. Reset per source via onLoadStart.
  const [previewFailed, setPreviewFailed] = useState(false);
  // Label per scene (original filename from an upload, or "Recorded take"), seeded from
  // the brief so a previously-attached clip still shows what it is.
  const [names, setNames] = useState<Record<number, string>>(initialNames);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [viewing, setViewing] = useState(false);

  const [camReady, setCamReady] = useState(false);
  const scene = doc.scenes[active];
  const currentUrl = footage[active] ?? null;
  const currentName = names[active];
  const pxPerSec = speed * 10;
  const busy = recording || countdown != null || uploading;

  const saveBlob = useCallback(
    async (sceneIdx: number, blob: Blob) => {
      if (mode === "local") {
        const previousUrl = localUrlsRef.current[sceneIdx];
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        const url = URL.createObjectURL(blob);
        localUrlsRef.current[sceneIdx] = url;
        setFootage((current) => ({ ...current, [sceneIdx]: url }));
        setNames((current) => ({ ...current, [sceneIdx]: "Demo take" }));
        setViewing(true);
        onLocalRecording?.(blob);
        toast.success("Take ready - nothing was uploaded");
        return;
      }
      if (!briefId) {
        toast.error("No brief to attach this footage to.");
        return;
      }
      setUploading(true);
      setUploadPct(0);
      try {
        // Direct browser -> Supabase (signed URL) so long takes aren't capped by the
        // Vercel serverless body limit. See src/lib/upload.ts.
        const url = await uploadSceneFootageDirect({
          briefId,
          sceneIndex: sceneIdx,
          file: blob,
          contentType: blob.type,
          onProgress: setUploadPct,
        });
        setFootage((m) => ({ ...m, [sceneIdx]: url }));
        setNames((n) => ({ ...n, [sceneIdx]: "Recorded take" }));
        onFootageChange?.(sceneIdx, url, "Recorded take");
        toast.success(`Scene ${sceneIdx + 1} uploaded`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [briefId, mode, onFootageChange, onLocalRecording],
  );

  const deleteCurrent = useCallback(async () => {
    const idx = active;
    setViewing(false);
    if (mode === "local") {
      const currentUrl = localUrlsRef.current[idx];
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      delete localUrlsRef.current[idx];
      setFootage((current) => {
        const next = { ...current };
        delete next[idx];
        return next;
      });
      setNames((current) => {
        const next = { ...current };
        delete next[idx];
        return next;
      });
      onLocalRecording?.(null);
      setElapsed(0);
      return;
    }
    if (!briefId) return;
    try {
      const res = await fetch("/api/footage", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefId, sceneIndex: idx }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Delete failed");
      }
      setFootage((m) => {
        const next = { ...m };
        delete next[idx];
        return next;
      });
      setNames((n) => {
        const next = { ...n };
        delete next[idx];
        return next;
      });
      onFootageChange?.(idx, null);
      setElapsed(0);
      toast.success("Footage deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }, [briefId, active, mode, onFootageChange, onLocalRecording]);

  const resetScroll = useCallback(() => {
    offsetRef.current = 0;
    if (trackRef.current) trackRef.current.style.transform = "translateY(0px)";
  }, []);

  const applyOffset = useCallback((px: number) => {
    const track = trackRef.current;
    const vp = viewportRef.current;
    if (!track || !vp) return;
    const max = Math.max(0, track.scrollHeight - vp.clientHeight);
    const clamped = Math.min(Math.max(0, px), max);
    offsetRef.current = clamped;
    track.style.transform = `translateY(${-clamped}px)`;
    return clamped >= max;
  }, []);

  // Camera + mic.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        if (!cancelled) setCamReady(true);
      } catch (e) {
        if (!cancelled) setCamError(e instanceof Error ? e.message : "Camera/mic unavailable");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Scroll loop (in case a single scene's text overflows the reading area).
  useEffect(() => {
    const tick = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      if (playingRef.current) {
        const atEnd = applyOffset(offsetRef.current + pxPerSec * dt);
        if (atEnd) {
          playingRef.current = false;
          setPlaying(false);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
  }, [pxPerSec, applyOffset]);

  useEffect(
    () => () => {
      Object.values(localUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      localUrlsRef.current = {};
    },
    [],
  );

  const setPlay = useCallback((v: boolean) => {
    playingRef.current = v;
    setPlaying(v);
  }, []);

  const startCanvasDraw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const target = canvas.width / canvas.height;
    const draw = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh) {
        const srcA = vw / vh;
        let sx: number, sy: number, sw: number, sh: number;
        if (srcA > target) {
          sh = vh;
          sw = vh * target;
          sx = (vw - sw) / 2;
          sy = 0;
        } else {
          sw = vw;
          sh = vw / target;
          sx = 0;
          sy = (vh - sh) / 2;
        }
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      }
      drawRafRef.current = requestAnimationFrame(draw);
    };
    drawRafRef.current = requestAnimationFrame(draw);
  }, []);

  const stopCanvasDraw = useCallback(() => {
    if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
    drawRafRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    setPlay(false);
    const mr = recorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    recorderRef.current = null;
    stopCanvasDraw();
    setRecording(false);
  }, [setPlay, stopCanvasDraw]);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      setElapsed((current) => {
        const next = current + 1;
        if (maxRecordingSeconds && next >= maxRecordingSeconds) {
          window.clearInterval(id);
          window.setTimeout(stopRecording, 0);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [maxRecordingSeconds, recording, stopRecording]);

  const beginRecord = useCallback(async () => {
    if (busy) return;
    setViewing(false);
    resetScroll();
    setElapsed(0);

    for (let n = 3; n >= 1; n--) {
      setCountdown(n);
      await sleep(750);
    }
    setCountdown(null);

    const stream = streamRef.current;
    if (stream) {
      try {
        chunksRef.current = [];
        const mimeType = pickMimeType();
        let recordStream: MediaStream = stream;
        // Canvas capture gives a clean 9:16 crop, but Safari/iOS records a
        // canvas.captureStream unreliably (often 0-byte). There, record the raw
        // camera stream instead so a take is always produced.
        const canvas = canvasRef.current;
        const canCropReliably =
          !isAppleWebKit() && canvas && typeof canvas.captureStream === "function";
        if (canCropReliably) {
          startCanvasDraw();
          const canvasStream = canvas!.captureStream(30);
          const audio = stream.getAudioTracks()[0];
          if (audio) canvasStream.addTrack(audio);
          recordStream = canvasStream;
        }
        const sceneIdx = active;
        const mr = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.onerror = () => {
          stopCanvasDraw();
          setRecording(false);
          toast.error(
            mode === "local"
              ? "Recording failed on this device. You can still preview the teleprompter."
              : "Recording failed on this device. Try again or use Upload.",
          );
        };
        mr.onstop = () => {
          if (chunksRef.current.length === 0) {
            toast.error(
              mode === "local"
                ? "No video was captured. Check camera access and try again."
                : "No video was captured. Try again or use Upload instead.",
            );
            return;
          }
          const blob = new Blob(chunksRef.current, { type: mimeType || "video/webm" });
          void saveBlob(sceneIdx, blob);
        };
        // Timeslice so data flushes progressively (more robust on Safari/iOS than
        // a single flush at stop, which can drop the whole take).
        mr.start(1000);
        recorderRef.current = mr;
        setRecording(true);
      } catch {
        stopCanvasDraw();
        toast.error(
          mode === "local"
            ? "Couldn't start recording on this device. You can still preview the teleprompter."
            : "Couldn't start recording on this device. Try Upload instead.",
        );
      }
    }
    setPlay(true);
  }, [busy, active, mode, resetScroll, saveBlob, startCanvasDraw, stopCanvasDraw, setPlay]);

  const goToScene = useCallback(
    (i: number) => {
      if (busy) return;
      setActive(Math.min(Math.max(0, i), sceneCount - 1));
      resetScroll();
      setElapsed(0);
      setViewing(false);
      setPlay(false);
    },
    [busy, sceneCount, resetScroll, setPlay],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.code === "Space") {
        e.preventDefault();
        setPlay(!playingRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, setPlay]);

  useEffect(() => () => stopCanvasDraw(), [stopCanvasDraw]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-start gap-3 overflow-y-auto p-3 py-4 sm:gap-4 sm:p-4 sm:py-8 lg:flex-row lg:justify-center lg:gap-8 lg:py-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <canvas ref={canvasRef} width={720} height={1280} className="hidden" />

      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg text-white/80 backdrop-blur transition hover:bg-white/20 hover:text-white"
      >
        ✕
      </button>

      {/* 9:16 phone frame */}
      <div className="relative z-10 aspect-[9/16] h-[50vh] max-w-[92vw] shrink-0 overflow-hidden rounded-[2.4rem] border-[6px] border-neutral-800 bg-black shadow-2xl lg:h-[85vh]">
        {/* Playback of the uploaded take for this scene */}
        {viewing && currentUrl ? (
          previewFailed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
              <span className="text-4xl">🎞</span>
              <p className="font-mono text-sm text-white/90">Can&apos;t preview this format in the browser.</p>
              <p className="font-mono text-[11px] text-white/50">
                It&apos;ll still render fine — proof re-encodes it during editing.
              </p>
            </div>
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={currentUrl}
              controls
              autoPlay
              playsInline
              onLoadStart={() => setPreviewFailed(false)}
              onError={() => setPreviewFailed(true)}
              className="absolute inset-0 h-full w-full bg-black object-contain"
            />
          )
        ) : (
          <>
            {!camError && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                ref={videoRef}
                muted
                playsInline
                className="absolute inset-0 h-full w-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />
            )}
            {camError && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-900 px-6 text-center text-sm text-white/60">
                Camera unavailable ({camError}). Reader only.
              </div>
            )}
            {!camReady && !camError && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-neutral-900/80 text-white/70">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                <span className="font-mono text-xs uppercase tracking-[0.2em]">
                  Starting camera…
                </span>
              </div>
            )}
          </>
        )}

        {!viewing && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[52%] bg-gradient-to-b from-black/75 via-black/45 to-transparent" />
        )}

        {recording && (
          <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-1 backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#e0533d]" />
            <span className="font-mono text-[11px] text-white">{fmt(elapsed)}</span>
          </div>
        )}
        {uploading && (
          <div className="absolute left-3 top-3 z-20 flex flex-col gap-1 rounded-lg bg-black/60 px-2.5 py-1.5 backdrop-blur">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#e0533d]" />
              <span className="font-mono text-[10px] text-white">
                uploading… {Math.round(uploadPct * 100)}%
              </span>
            </div>
            <div className="h-1 w-28 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-[#e0533d] transition-[width] duration-150"
                style={{ width: `${Math.max(4, uploadPct * 100)}%` }}
              />
            </div>
          </div>
        )}
        {currentUrl && !recording && !uploading && (
          <div className="absolute left-3 top-3 z-20 rounded-full bg-[#e0533d] px-2 py-1 font-mono text-[10px] text-white">
            {mode === "local" ? "saved locally" : "uploaded"}
          </div>
        )}

        {/* Reading area: only the active scene */}
        <div
          ref={viewportRef}
          className={`absolute inset-x-0 top-0 h-[50%] overflow-hidden ${viewing ? "hidden" : ""}`}
          style={{
            maskImage: "linear-gradient(to bottom, black 72%, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, black 72%, transparent)",
          }}
        >
          <div
            ref={trackRef}
            className="px-5 will-change-transform"
            style={{ transform: "translateY(0px)", scale: mirror ? "-1 1" : undefined }}
          >
            <div style={{ height: "7vh" }} />
            <p
              className="font-semibold leading-snug text-white drop-shadow"
              style={{ fontSize: `${1.4 * fontScale}rem` }}
            >
              {scene?.spokenLine}
            </p>
            {(scene?.onScreenText || scene?.brollCue) && (
              <div className="mt-2 space-y-0.5 text-white/35">
                {scene?.onScreenText && (
                  <p className="text-[11px]">
                    <span className="font-mono uppercase tracking-widest text-white/30">
                      text ·{" "}
                    </span>
                    {scene.onScreenText}
                  </p>
                )}
                {scene?.brollCue && (
                  <p className="text-[11px] italic">
                    <span className="font-mono uppercase not-italic tracking-widest text-white/30">
                      show ·{" "}
                    </span>
                    {scene.brollCue}
                  </p>
                )}
              </div>
            )}
            <div style={{ height: "20vh" }} />
          </div>
        </div>

        {countdown != null && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30">
            <span className="font-display text-8xl font-bold text-white drop-shadow-lg">
              {countdown}
            </span>
          </div>
        )}
      </div>

      {/* Controls (side panel) */}
      <div className="relative z-10 flex w-full max-w-[320px] shrink-0 flex-col items-stretch gap-5 lg:w-[280px]">
        {/* Scene heading */}
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/50">
            Scene {String(scene?.scene ?? active + 1).padStart(2, "0")} / {sceneCount}
          </p>
          {scene?.label && (
            <p className="mt-1 font-display text-2xl tracking-tight text-white">{scene.label}</p>
          )}
          {mode === "local" && (
            <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#e0533d]">
                {currentUrl ? "Step 3 of 3" : recording ? "Step 2 of 3" : "Step 1 of 3"}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-white/85">
                {currentUrl
                  ? "Preview your clip. If it looks good, choose Use this take."
                  : recording
                    ? "Read the script as it scrolls. Press the red stop button when you finish."
                    : "Press the red circle below. You will get a 3-second countdown before recording starts."}
              </p>
            </div>
          )}
          {mode === "local" && (
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              Nothing is uploaded or saved.
            </p>
          )}
        </div>

        <div className="flex items-center justify-center gap-3">
          {mode !== "local" && (
            <button
              onClick={() => goToScene(active - 1)}
              disabled={busy || active === 0}
              className="rounded-full border border-white/25 px-3 py-2 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-30"
            >
              ‹ Prev
            </button>
          )}

          {recording ? (
            <button
              onClick={stopRecording}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e0533d] text-white transition hover:bg-[#c8472f]"
              aria-label="Stop"
            >
              <span className="h-5 w-5 rounded-sm bg-white" />
            </button>
          ) : (
            <button
              onClick={beginRecord}
              disabled={countdown != null || uploading}
              className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/70 transition hover:border-white disabled:opacity-50"
              aria-label="Record this scene"
            >
              <span className="h-9 w-9 rounded-full bg-[#e0533d]" />
            </button>
          )}

          {mode !== "local" && (
            <button
              onClick={() => goToScene(active + 1)}
              disabled={busy || active === sceneCount - 1}
              className="rounded-full border border-white/25 px-3 py-2 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-30"
            >
              Next ›
            </button>
          )}
        </div>

        <div
          className={`flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-white/60 ${
            mode === "local" ? "hidden" : "flex"
          }`}
        >
          <button
            onClick={() => setPlay(!playing)}
            className="rounded-full border border-white/25 px-3 py-1 text-white/80 transition hover:bg-white/10"
          >
            {playing ? "Pause" : "Play"}
          </button>
          <label className="flex items-center gap-2">
            Speed
            <input
              type="range"
              min={1}
              max={10}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="accent-[#e0533d]"
            />
          </label>
          <div className="flex items-center gap-1">
            Size
            <button
              onClick={() => setFontScale((f) => Math.max(0.6, +(f - 0.1).toFixed(2)))}
              className="rounded border border-white/20 px-1.5 hover:bg-white/10"
            >
              A-
            </button>
            <button
              onClick={() => setFontScale((f) => Math.min(2, +(f + 0.1).toFixed(2)))}
              className="rounded border border-white/20 px-1.5 hover:bg-white/10"
            >
              A+
            </button>
          </div>
          <button
            onClick={() => setMirror((m) => !m)}
            className={`rounded border px-2 py-1 transition ${
              mirror ? "border-[#e0533d] text-[#e0533d]" : "border-white/20 hover:bg-white/10"
            }`}
          >
            Mirror
          </button>
        </div>

        {currentUrl && !recording && !uploading && (
          <div className="flex flex-col gap-2">
            <p
              className="truncate font-mono text-[11px] text-white/55"
              title={currentName ?? "Recorded take"}
            >
              <span className="uppercase tracking-[0.18em] text-white/35">clip · </span>
              {currentName ?? "Recorded take"}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewing((v) => !v)}
                className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black transition hover:bg-white/90"
              >
                {viewing ? "Back to camera" : "▷ View take"}
              </button>
              <button
                onClick={deleteCurrent}
                className="rounded-full border border-white/25 px-4 py-1.5 text-xs text-white/70 transition hover:border-[#e0533d] hover:text-[#e0533d]"
              >
                Delete
              </button>
              {mode === "local" && (
                <button
                  onClick={onClose}
                  className="rounded-full bg-[#e0533d] px-4 py-1.5 text-xs font-medium text-white transition hover:bg-[#c8472f]"
                >
                  Use this take
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scene picker with recorded ticks */}
        <div className={`max-w-full flex-wrap justify-center gap-1.5 ${mode === "local" ? "hidden" : "flex"}`}>
          {doc.scenes.map((s, i) => {
            const has = !!footage[i];
            const isActive = i === active;
            return (
              <button
                key={i}
                onClick={() => goToScene(i)}
                disabled={busy}
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition disabled:opacity-40 ${
                  isActive
                    ? "border-white bg-white/15 text-white"
                    : has
                      ? "border-[#e0533d]/70 text-[#e0533d]"
                      : "border-white/15 text-white/55 hover:border-white/50 hover:text-white"
                }`}
              >
                {has ? "✓ " : ""}
                {String(s.scene ?? i + 1).padStart(2, "0")}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
