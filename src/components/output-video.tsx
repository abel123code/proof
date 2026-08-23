"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

/**
 * The finished output, playing.
 *
 * This replaced a scroll-scrubbed version. Tying the playhead to scroll was a
 * neat trick and the wrong call: the visitor had to operate the one asset that
 * should simply be shown to them, scrubbing cannot carry audio, and the
 * voiceover is half of what Proof actually makes. Scroll-driven motion belongs
 * on decoration, not on the product demo.
 *
 * So it behaves like a video: it starts on its own when it comes into view,
 * loops, and gets out of the way when it scrolls off. Sound is one obvious tap,
 * and taking it restarts from the top so nobody joins the voiceover halfway.
 */

const RECEIPTS = [
  { claim: "1st Runner-Up", source: "'Sup Build2026, 300+ builders" },
  { claim: "One take", source: "read off the teleprompter" },
  { claim: "5 frames a scene", source: "checked before it ships" },
  { claim: "~8 minutes", source: "repo to finished MP4" },
];

export function OutputVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);
  const [inView, setInView] = useState(false);

  // Reduced motion never gets an autoplaying video; it gets native controls.
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reduced) return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      // Wait until it is properly on screen. A video half out of frame starting
      // to talk is the thing everyone hates about autoplay.
      { threshold: 0.5 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [reduced]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reduced) return;
    if (inView) void video.play().catch(() => {});
    else video.pause();
  }, [inView, reduced]);

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;

    if (sound) {
      video.muted = true;
      setSound(false);
      return;
    }

    video.muted = false;
    video.currentTime = 0;
    setSound(true);
    // Browsers can still refuse an unmuted play. Fall back rather than leaving
    // the button lying about the state.
    void video.play().catch(() => {
      video.muted = true;
      setSound(false);
    });
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-20 sm:px-8 md:py-28 lg:grid-cols-[1fr_auto] lg:gap-16">
      <div className="order-2 lg:order-1">
        <p className="kicker">one it made</p>
        <h2 className="mt-4 max-w-[15ch] font-display text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl">
          This is the output.{" "}
          <span className="text-primary">Sound on.</span>
        </h2>
        <p className="mt-5 max-w-md text-lg leading-relaxed text-muted-foreground">
          Abhishek read one scene off the teleprompter. Everything else on screen
          is Proof: the cuts, the captions, the graphics.
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
      </div>

      <div className="order-1 lg:order-2">
        <div className="mx-auto w-[13rem] sm:w-[15rem] lg:w-[17rem]">
          <button
            type="button"
            onClick={toggleSound}
            aria-label={sound ? "Mute the video" : "Play the video with sound"}
            className="group relative block aspect-[9/16] w-full cursor-pointer overflow-hidden rounded-[2rem] border-[6px] border-[#151515] bg-black shadow-[0_28px_70px_-36px_rgba(25,20,16,0.78)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          >
            <video
              ref={videoRef}
              src="/proof-demo.mp4"
              poster="/proof-demo-poster.jpg"
              muted={!sound}
              loop
              playsInline
              preload="metadata"
              controls={reduced}
              className="absolute inset-0 h-full w-full object-cover"
            />

            {/* The universal muted marker. Sits top-right, clear of the burnt-in
                captions along the bottom. */}
            {!reduced && (
              <span
                aria-hidden
                className="pointer-events-none absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors group-hover:bg-black/75"
              >
                {sound ? (
                  <Volume2 className="size-4" />
                ) : (
                  <VolumeX className="size-4" />
                )}
              </span>
            )}
          </button>

          {!reduced && (
            <button
              type="button"
              onClick={toggleSound}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 font-mono text-sm font-medium text-primary-foreground transition-all hover:brightness-105 active:translate-y-px"
            >
              {sound ? (
                <>
                  <VolumeX className="size-4" aria-hidden /> mute
                </>
              ) : (
                <>
                  <Volume2 className="size-4" aria-hidden /> play with sound
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
