"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The output, scrubbed by scroll position.
 *
 * Proof makes videos, so the page's own scroll is the playhead: scroll down and
 * the video advances, scroll back and it rewinds. It is reversible and the
 * visitor is driving it, which is the point — a video that plays itself is
 * something you watch, and this is something you operate.
 *
 * The file is encoded with a keyframe every 15 frames (0.5s) specifically so
 * these seeks land quickly; a normal web encode has sparse keyframes and scrubs
 * like porridge.
 */

/** Scroll distance the scrub is spread over. 3x viewport is slow enough to read
 *  the captions without turning the page into a tunnel. */
const SCRUB_VH = 3;

const RECEIPTS = [
  { claim: "1st Runner-Up", source: "'Sup Build2026, 300+ builders" },
  { claim: "One take", source: "read off the teleprompter" },
  { claim: "5 frames a scene", source: "checked before it ships" },
  { claim: "~8 minutes", source: "repo to finished MP4" },
];

export function ScrollScrubVideo() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef(0);
  const targetRef = useRef(0);

  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scrubbable, setScrubbable] = useState(false);

  // Reduced motion, and any browser that will not give us a duration, both fall
  // back to an ordinary video with controls rather than a dead poster.
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // `loadedmetadata` fires the moment the file is cached, which can be before
  // React has attached the handler — the event is then lost and the section
  // never becomes scrubbable. Check the state directly on mount as well.
  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState >= 1) setScrubbable(true);
  }, []);

  const applySeek = useCallback(() => {
    rafRef.current = 0;
    const video = videoRef.current;
    if (!video || video.readyState < 1) return;
    // A seek finer than a frame is wasted work and makes Safari stutter.
    if (Math.abs(video.currentTime - targetRef.current) > 0.033) {
      video.currentTime = targetRef.current;
    }
  }, []);

  const onScroll = useCallback(() => {
    const section = sectionRef.current;
    const video = videoRef.current;
    if (!section || !video) return;

    const travel = section.offsetHeight - window.innerHeight;
    if (travel <= 0) return;

    const p = Math.min(1, Math.max(0, -section.getBoundingClientRect().top / travel));
    setProgress(p);

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    // Stop a hair short of the end: seeking to exactly duration parks some
    // browsers on a blank frame.
    targetRef.current = p * (duration - 0.05);
    if (!rafRef.current) rafRef.current = requestAnimationFrame(applySeek);
  }, [applySeek]);

  useEffect(() => {
    if (reduced || !scrubbable || playing) return;
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [reduced, scrubbable, playing, onScroll]);

  const playWithSound = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.currentTime = 0;
    void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const stopSound = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.muted = true;
    setPlaying(false);
    onScroll();
  };

  const scrubbing = !reduced && scrubbable && !playing;

  return (
    <div
      ref={sectionRef}
      style={{ height: scrubbing ? `${SCRUB_VH * 100}vh` : undefined }}
      className="relative"
    >
      <div
        className={
          scrubbing
            ? "sticky top-0 flex h-screen items-center overflow-hidden"
            : "flex items-center py-20"
        }
      >
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_auto]">
          <div className="order-2 lg:order-1">
            <p className="kicker">one it made</p>
            <h2 className="mt-4 max-w-[15ch] font-display text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl">
              This is the output.{" "}
              <span className="text-primary">Scroll it.</span>
            </h2>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-muted-foreground">
              Abhishek read one scene off the teleprompter. Everything else on
              screen — the cuts, the captions, the graphics — is Proof.
            </p>

            <dl className="mt-9 grid max-w-md grid-cols-2 gap-x-8 gap-y-5">
              {RECEIPTS.map((r) => (
                <div key={r.claim} className="border-t border-border pt-3">
                  <dt className="font-mono text-sm text-primary">{r.claim}</dt>
                  <dd className="mt-1 text-sm leading-snug text-muted-foreground">
                    {r.source}
                  </dd>
                </div>
              ))}
            </dl>

            <button
              type="button"
              onClick={playing ? stopSound : playWithSound}
              className="mt-8 inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 font-mono text-sm text-foreground transition-colors hover:bg-muted"
            >
              {playing ? "stop" : "play it with sound"}
            </button>
          </div>

          <div className="order-1 lg:order-2">
            <div className="relative mx-auto w-[15rem] sm:w-[17rem]">
              <div className="relative aspect-[9/16] overflow-hidden rounded-[2rem] border-[6px] border-[#151515] bg-black shadow-[0_28px_70px_-36px_rgba(25,20,16,0.78)]">
                <video
                  ref={videoRef}
                  src="/proof-demo.mp4"
                  poster="/proof-demo-poster.jpg"
                  muted
                  playsInline
                  preload="auto"
                  controls={reduced}
                  onEnded={stopSound}
                  onLoadedMetadata={() => setScrubbable(true)}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>

              {scrubbing && (
                <div
                  aria-hidden
                  className="mx-auto mt-4 h-[3px] w-full overflow-hidden rounded-full bg-border"
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
