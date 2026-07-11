"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { BriefDoc } from "@/lib/types";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
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
  onFootageChange,
  onClose,
}: {
  doc: BriefDoc;
  briefId: string | null;
  startScene?: number;
  initialFootage?: Record<number, string>;
  onFootageChange?: (sceneIndex: number, url: string | null) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRafRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
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
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(false);

  const [camReady, setCamReady] = useState(false);
  const scene = doc.scenes[active];
  const currentUrl = footage[active] ?? null;
  const pxPerSec = speed * 10;
  const busy = recording || countdown != null || uploading;

  const uploadBlob = useCallback(
    async (sceneIdx: number, blob: Blob) => {
      if (!briefId) {
        toast.error("No brief to attach this footage to.");
        return;
      }
      setUploading(true);
      try {
        const ext = blob.type.includes("mp4") ? "mp4" : "webm";
        const fd = new FormData();
        fd.append("briefId", briefId);
        fd.append("sceneIndex", String(sceneIdx));
        fd.append("file", blob, `scene-${sceneIdx}.${ext}`);
        const res = await fetch("/api/footage", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        setFootage((m) => ({ ...m, [sceneIdx]: data.url }));
        onFootageChange?.(sceneIdx, data.url);
        toast.success(`Scene ${sceneIdx + 1} uploaded`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [briefId, onFootageChange],
  );

  const deleteCurrent = useCallback(async () => {
    if (!briefId) return;
    const idx = active;
    setViewing(false);
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
      onFootageChange?.(idx, null);
      setElapsed(0);
      toast.success("Footage deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }, [briefId, active, onFootageChange]);

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

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

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
        const canvas = canvasRef.current;
        if (canvas && typeof canvas.captureStream === "function") {
          startCanvasDraw();
          const canvasStream = canvas.captureStream(30);
          const audio = stream.getAudioTracks()[0];
          if (audio) canvasStream.addTrack(audio);
          recordStream = canvasStream;
        }
        const sceneIdx = active;
        const mr = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType || "video/webm" });
          void uploadBlob(sceneIdx, blob);
        };
        mr.start();
        recorderRef.current = mr;
        setRecording(true);
      } catch {
        stopCanvasDraw();
      }
    }
    setPlay(true);
  }, [busy, active, resetScroll, startCanvasDraw, stopCanvasDraw, setPlay, uploadBlob]);

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
    <div className="fixed inset-0 z-50 flex flex-row items-center justify-center gap-8 p-4">
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
      <div className="relative z-10 aspect-[9/16] h-[90vh] max-h-[90vh] overflow-hidden rounded-[2.4rem] border-[6px] border-neutral-800 bg-black shadow-2xl">
        {/* Playback of the uploaded take for this scene */}
        {viewing && currentUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={currentUrl}
            controls
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
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
          <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            <span className="font-mono text-[10px] text-white">uploading…</span>
          </div>
        )}
        {currentUrl && !recording && !uploading && (
          <div className="absolute left-3 top-3 z-20 rounded-full bg-[#e0533d] px-2 py-1 font-mono text-[10px] text-white">
            ✓ uploaded
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
      <div className="relative z-10 flex w-[280px] flex-col items-stretch gap-5">
        {/* Scene heading */}
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/50">
            Scene {String(scene?.scene ?? active + 1).padStart(2, "0")} / {sceneCount}
          </p>
          {scene?.label && (
            <p className="mt-1 font-display text-2xl tracking-tight text-white">{scene.label}</p>
          )}
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => goToScene(active - 1)}
            disabled={busy || active === 0}
            className="rounded-full border border-white/25 px-3 py-2 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-30"
          >
            ‹ Prev
          </button>

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

          <button
            onClick={() => goToScene(active + 1)}
            disabled={busy || active === sceneCount - 1}
            className="rounded-full border border-white/25 px-3 py-2 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-30"
          >
            Next ›
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-white/60">
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
          </div>
        )}

        {/* Scene picker with recorded ticks */}
        <div className="flex max-w-full flex-wrap justify-center gap-1.5">
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
