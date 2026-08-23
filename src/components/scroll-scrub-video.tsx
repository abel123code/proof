"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The output, scrubbed by scroll position.
 *
 * Proof makes videos, so the page's own scroll is the playhead: scroll down and
 * the video advances, scroll back and it rewinds. It is reversible and the
 * visitor is driving it, which is the point. A video that plays itself is
 * something you watch; this is something you operate.
 *
 * The file is encoded with a keyframe every 15 frames (0.5s) specifically so
 * these seeks land quickly. A normal web encode has sparse keyframes and scrubs
 * like porridge.
 *
 * Layout note: the scrub track below contains ONLY the pinned box, never
 * trailing content. The progress maths is `-sectionTop / (sectionHeight -
 * viewportHeight)`, which is only correct while the sticky element is the
 * section's whole content. Mobile detail therefore sits in a sibling after the
 * track, not inside it.
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

function Receipts({ className = "" }: { className?: string }) {
  return (
    <dl className={`grid max-w-md grid-cols-2 gap-x-8 gap-y-5 ${className}`}>
      {RECEIPTS.map((r) => (
        <div key={r.claim} className="border-t border-border pt-3">
          <dt className="font-mono text-sm text-primary">{r.claim}</dt>
          <dd className="mt-1 text-sm leading-snug text-muted-foreground">
            {r.source}
          </dd>
        </div>
      ))}
    </dl>
  );
}

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
  // React has attached the handler. The event is then lost and the section
  // never becomes scrubbable, so check the state directly on mount as well.
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

  const soundButton = (
    <button
      type="button"
      onClick={playing ? stopSound : playWithSound}
      className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 font-mono text-sm text-foreground transition-colors hover:bg-muted"
    >
      {playing ? "stop" : "play it with sound"}
    </button>
  );

  const blurb = (
    <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
      Abhishek read one scene off the teleprompter. Everything else on screen is
      Proof: the cuts, the captions, the graphics.
    </p>
  );

  return (
    <>
      <div
        ref={sectionRef}
        style={{ height: scrubbing ? `${SCRUB_VH * 100}vh` : undefined }}
        className="relative"
      >
        <div
          className={
            scrubbing
              ? "sticky top-0 flex h-screen items-center overflow-hidden pt-16"
              : "flex items-center py-20"
          }
        >
          <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-5 sm:px-8 lg:grid-cols-[1fr_auto] lg:gap-12">
            {/* Desktop column. Hidden on mobile, where it does not fit inside a
                pinned viewport alongside a 9:16 video. */}
            <div className="order-2 hidden lg:order-1 lg:block">
              <p className="kicker">one it made</p>
              <h2 className="mt-4 max-w-[15ch] font-display text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl">
                This is the output. <span className="text-primary">Scroll it.</span>
              </h2>
              <div className="mt-5">{blurb}</div>
              <Receipts className="mt-9" />
              <div className="mt-8">{soundButton}</div>
            </div>

            {/* Mobile heading, kept short so the pinned box stays inside the
                viewport on a 667px phone. */}
            <div className="order-1 lg:hidden">
              <p className="kicker">one it made</p>
              <h2 className="mt-3 font-display text-2xl font-medium leading-tight tracking-tight">
                This is the output. <span className="text-primary">Scroll it.</span>
              </h2>
            </div>

            <div className="order-2 lg:order-2">
              <div className="relative mx-auto w-[12rem] sm:w-[15rem] lg:w-[17rem]">
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

      {/* Mobile detail, after the scrub track rather than inside it. Keeping it
          out of the track is what stops the pinned box overflowing, and it also
          keeps the progress maths honest. */}
      {scrubbing && (
        <div className="mx-auto max-w-6xl px-5 pb-4 sm:px-8 lg:hidden">
          {blurb}
          <Receipts className="mt-8" />
          <div className="mt-8">{soundButton}</div>
        </div>
      )}
    </>
  );
}
