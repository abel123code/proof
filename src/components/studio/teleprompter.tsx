"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  startScene = 0,
  onClose,
}: {
  doc: BriefDoc;
  startScene?: number;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const sceneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const playingRef = useRef(false);

  const [camError, setCamError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [speed, setSpeed] = useState(5); // 1..10 -> px/sec
  const [fontScale, setFontScale] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);

  const pxPerSec = speed * 10;

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

  const jumpToScene = useCallback(
    (i: number) => {
      const el = sceneRefs.current[i];
      const vp = viewportRef.current;
      if (!el || !vp) return;
      const eyeline = vp.clientHeight * 0.18;
      applyOffset(el.offsetTop - eyeline);
    },
    [applyOffset],
  );

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
      } catch (e) {
        if (!cancelled) {
          setCamError(e instanceof Error ? e.message : "Camera/mic unavailable");
        }
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const id = setTimeout(() => jumpToScene(startScene), 80);
    return () => clearTimeout(id);
  }, [startScene, jumpToScene]);

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

  const stopRecording = useCallback(() => {
    setPlay(false);
    const mr = recorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    recorderRef.current = null;
    setRecording(false);
  }, [setPlay]);

  const beginRecord = useCallback(async () => {
    if (recording || countdown != null) return;
    setRecordedUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    jumpToScene(startScene);
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
        const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType || "video/webm" });
          setRecordedUrl(URL.createObjectURL(blob));
        };
        mr.start();
        recorderRef.current = mr;
        setRecording(true);
      } catch {
        /* fall through to reader-only */
      }
    }
    setPlay(true);
  }, [recording, countdown, jumpToScene, startScene, setPlay]);

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

  const downloadName = `${(doc.title || "brief")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)}.webm`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg text-white/80 backdrop-blur transition hover:bg-white/20 hover:text-white"
      >
        ✕
      </button>

      {/* 9:16 phone frame */}
      <div className="relative z-10 aspect-[9/16] h-[78vh] max-h-[78vh] overflow-hidden rounded-[2.2rem] border-[5px] border-neutral-800 bg-black shadow-2xl">
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
            Camera unavailable ({camError}). Running as a teleprompter only.
          </div>
        )}

        {/* Soft scrim only behind the reading area (top) so the camera stays visible */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[52%] bg-gradient-to-b from-black/75 via-black/45 to-transparent" />

        {/* REC indicator */}
        {recording && (
          <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-1 backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#e0533d]" />
            <span className="font-mono text-[11px] text-white">{fmt(elapsed)}</span>
          </div>
        )}

        {/* Teleprompter reading area */}
        <div
          ref={viewportRef}
          className="absolute inset-x-0 top-0 h-[50%] overflow-hidden"
          style={{
            maskImage: "linear-gradient(to bottom, black 70%, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent)",
          }}
        >
          <div
            ref={trackRef}
            className="px-5 will-change-transform"
            style={{ transform: "translateY(0px)", scale: mirror ? "-1 1" : undefined }}
          >
            <div style={{ height: "9vh" }} />
            {doc.scenes.map((s, i) => (
              <div
                key={i}
                ref={(el) => {
                  sceneRefs.current[i] = el;
                }}
                className="mb-7"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-[#e0533d]">
                    {String(s.scene ?? i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-white/40">
                    {s.label}
                  </span>
                </div>
                <p
                  className="font-semibold leading-snug text-white drop-shadow"
                  style={{ fontSize: `${1.35 * fontScale}rem` }}
                >
                  {s.spokenLine}
                </p>
                {(s.onScreenText || s.brollCue) && (
                  <div className="mt-1.5 space-y-0.5 text-white/35">
                    {s.onScreenText && (
                      <p className="text-[11px]">
                        <span className="font-mono uppercase tracking-widest text-white/30">
                          text ·{" "}
                        </span>
                        {s.onScreenText}
                      </p>
                    )}
                    {s.brollCue && (
                      <p className="text-[11px] italic">
                        <span className="font-mono uppercase not-italic tracking-widest text-white/30">
                          show ·{" "}
                        </span>
                        {s.brollCue}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div style={{ height: "30vh" }} />
          </div>
        </div>

        {/* Countdown */}
        {countdown != null && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30">
            <span className="font-display text-8xl font-bold text-white drop-shadow-lg">
              {countdown}
            </span>
          </div>
        )}
      </div>

      {/* Controls (below the phone) */}
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-3">
        <div className="flex items-center gap-3">
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
              disabled={countdown != null}
              className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/70 transition hover:border-white disabled:opacity-50"
              aria-label="Record"
            >
              <span className="h-9 w-9 rounded-full bg-[#e0533d]" />
            </button>
          )}

          <button
            onClick={() => setPlay(!playing)}
            className="rounded-full border border-white/25 px-4 py-2 text-xs text-white/80 transition hover:bg-white/10"
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button
            onClick={() => jumpToScene(startScene)}
            className="rounded-full border border-white/25 px-4 py-2 text-xs text-white/80 transition hover:bg-white/10"
          >
            Restart
          </button>

          {recordedUrl && (
            <a
              href={recordedUrl}
              download={downloadName}
              className="rounded-full bg-white px-4 py-2 text-xs font-medium text-black transition hover:bg-white/90"
            >
              ↓ Save
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-white/60">
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

        {/* Scene jump chips */}
        <div className="flex max-w-full flex-wrap justify-center gap-1.5">
          {doc.scenes.map((s, i) => (
            <button
              key={i}
              onClick={() => jumpToScene(i)}
              className="rounded-full border border-white/15 px-2 py-0.5 font-mono text-[10px] text-white/55 transition hover:border-white/50 hover:text-white"
            >
              {String(s.scene ?? i + 1).padStart(2, "0")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
