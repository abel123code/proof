import type { Metadata } from "next";
import { ProofMark } from "@/components/proof-mark";
import { LandingDemo } from "@/components/landing-demo";
import Link from "next/link";

export const metadata: Metadata = {
  // Brand comes from the root layout's "%s · proof" template, so don't repeat it here.
  title: "Turn your GitHub work into a video people watch",
  description:
    "Proof uses OpenAI GPT-5.6, Whisper, HyperFrames, and vision QA to research, script, cut, animate, and review product videos for founders.",
};

const teleprompterTags = ["teleprompter", "auto-edit", "captions + overlays"];

const pipeline = [
  { label: "repo" },
  { label: "Luna", key: true },
  { label: "Sol + web", key: true },
  { label: "brief" },
  { label: "record" },
  { label: "Whisper", key: true },
  { label: "HyperFrames" },
  { label: "Sol vision", key: true },
  { label: "mp4" },
];

export default function Landing() {
  return (
    <div className="min-h-screen scroll-smooth bg-background text-foreground">
      {/* ---------- Sticky header ---------- */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <ProofMark className="size-7" />
            <span className="font-mono text-sm font-medium tracking-wide text-foreground">
              Proof
            </span>
          </Link>

          <nav className="hidden items-center gap-8 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground md:flex">
            <a href="#problem" className="transition-colors hover:text-foreground">
              Problem
            </a>
            <a href="#how" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#compare" className="transition-colors hover:text-foreground">
              Proof vs. slop
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="#demo"
              className="hidden rounded-full px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              Demo
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center rounded-full bg-primary px-5 py-2 font-mono text-xs font-medium uppercase tracking-[0.14em] text-primary-foreground transition-all hover:brightness-105 active:translate-y-px"
            >
              Log in
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="relative overflow-hidden">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 sm:px-8 md:grid-cols-[1.15fr_0.85fr] md:py-28 lg:py-32">
            <div>
              <p className="mb-5 font-mono text-xs uppercase tracking-[0.18em] text-primary">
                OpenAI Build Week · GPT-5.6 + Codex
              </p>
              <h1 className="font-display text-5xl font-medium leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
                Turn your GitHub work into a video people
                <span className="text-primary"> watch.</span>
              </h1>

              <p className="mt-7 max-w-md text-lg leading-relaxed text-muted-foreground">
                Proof researches the angle, writes the brief, gives you a
                teleprompter, cuts the take, authors the graphics, and reviews
                the finished frames. You choose the story and record it.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-4">
                <Link
                  href="/connect"
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-mono text-sm font-medium text-primary-foreground transition-all hover:translate-x-0.5 hover:brightness-105"
                >
                  connect your repo <span aria-hidden>→</span>
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 font-mono text-sm text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                >
                  log in
                </Link>
              </div>

              <p className="mt-10 font-mono text-sm text-muted-foreground">
                your repo proves you built it.
                <span className="font-medium text-primary"> nobody outside GitHub reads it.</span>
              </p>
            </div>

            <div className="relative mx-auto w-full max-w-sm pb-8 md:pb-0">
              <div className="overflow-hidden rounded-[2rem] border border-border bg-[#171411] p-3 shadow-[0_26px_70px_-34px_rgba(46,24,12,0.7)]">
                <div className="flex items-center justify-between px-2 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[#b9afa5]">
                  <span>Proof render</span>
                  <span className="flex items-center gap-1.5 text-[#8ed1a8]">
                    <span className="size-1.5 rounded-full bg-[#55b97b]" />
                    Sol QA passed
                  </span>
                </div>

                <div className="relative aspect-[9/13] overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#0d0c0b] text-white">
                  <div className="absolute inset-x-5 top-5 z-20">
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#c78b63]">
                      scene 03 · proof from the repo
                    </p>
                    <p className="mt-2 max-w-[13ch] font-display text-3xl leading-[0.92] tracking-tight">
                      One place for every deadline.
                    </p>
                  </div>

                  <div className="absolute inset-x-4 top-[42%] z-20 grid grid-cols-2 gap-2 font-mono text-[9px]">
                    <div className="rounded-xl border border-white/15 bg-[#221c18] p-3">
                      <span className="text-[#c78b63]">01</span>
                      <p className="mt-3 text-white/90">Canvas quiz</p>
                      <p className="mt-1 text-white/45">tomorrow · 23:59</p>
                    </div>
                    <div className="rounded-xl border border-[#c78b63]/60 bg-[#332218] p-3">
                      <span className="text-[#e3a97f]">02</span>
                      <p className="mt-3 text-white/90">2D submission</p>
                      <p className="mt-1 text-white/45">fri · 18:00</p>
                    </div>
                  </div>

                  <div className="absolute bottom-12 left-1/2 h-36 w-28 -translate-x-1/2 rounded-t-[5rem] bg-[#6f4b39] opacity-80" />
                  <div className="absolute bottom-6 left-1/2 z-20 w-[78%] -translate-x-1/2 rounded-md bg-white px-3 py-2 text-center font-mono text-[10px] font-semibold text-black">
                    your deadlines should not live in six tabs
                  </div>
                </div>

                <div className="mt-3 grid gap-2 px-1 pb-1 font-mono text-[9px] text-[#b9afa5]">
                  <div className="grid grid-cols-[3rem_1fr] items-center gap-2">
                    <span>speech</span>
                    <span className="h-1.5 rounded-full bg-[#5b5149]" />
                  </div>
                  <div className="grid grid-cols-[3rem_1fr] items-center gap-2">
                    <span>scene</span>
                    <span className="h-1.5 w-[64%] rounded-full bg-[#c78b63]" />
                  </div>
                  <div className="grid grid-cols-[3rem_1fr] items-center gap-2">
                    <span>vision</span>
                    <span className="text-[#8ed1a8]">5 frames · approved</span>
                  </div>
                </div>
              </div>
              <a
                href="#demo"
                aria-label="Try the Proof recording demo with no sign-up, one scene in about 30 seconds"
                className="group absolute -bottom-2 left-1/2 z-30 flex w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-primary/30 bg-card/95 p-3.5 text-left shadow-[0_18px_45px_-20px_rgba(67,30,18,0.5)] backdrop-blur transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-[0_22px_55px_-20px_rgba(67,30,18,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto sm:min-w-72 md:left-0 md:-translate-x-6"
              >
                <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <span
                    className="absolute size-3 rounded-full bg-primary/30 motion-safe:animate-ping"
                    aria-hidden
                  />
                  <span className="relative size-2.5 rounded-full bg-primary" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
                    No-signup demo
                  </span>
                  <span className="mt-0.5 block font-display text-lg leading-tight tracking-tight text-foreground">
                    Try Proof yourself
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                    1 scene · about 30 sec
                  </span>
                </span>
                <span
                  className="font-mono text-lg text-primary transition-transform duration-200 group-hover:translate-x-1"
                  aria-hidden
                >
                  ↓
                </span>
              </a>
            </div>
          </div>
        </section>

        {/* ---------- Problem ---------- */}
        <section
          id="problem"
          className="border-t border-border/60 bg-card/40"
        >
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <p className="kicker">the problem</p>
            <h2 className="mt-5 max-w-[16ch] font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
              Good code <span className="text-primary">isn&apos;t enough.</span>
            </h2>

            <ul className="mt-10 grid max-w-2xl gap-5">
              {[
                <>
                  Shipping is easy now. Getting people to{" "}
                  <span className="font-semibold text-foreground">use</span> it
                  isn&apos;t.
                </>,
                <>
                  Traction comes from marketing — not from the code being good.
                </>,
                <>
                  And marketing is the one thing developers{" "}
                  <span className="font-semibold text-foreground">won&apos;t</span>{" "}
                  do.
                </>,
              ].map((line, idx) => (
                <li
                  key={idx}
                  className="relative pl-6 text-lg leading-relaxed text-muted-foreground"
                >
                  <span className="absolute left-0 top-[0.6em] size-[7px] rotate-45 bg-primary/60" />
                  {line}
                </li>
              ))}
            </ul>

            <p className="mt-10 max-w-[24ch] font-display text-2xl font-medium leading-tight tracking-tight sm:text-3xl">
              So the best work goes unseen —{" "}
              <span className="text-primary">and no one ever hears about you.</span>
            </p>
          </div>
        </section>

        {/* ---------- What it is ---------- */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <p className="kicker">what it is</p>
            <h2 className="mt-5 font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
              Connect a repo.
              <br />
              <span className="text-primary">Get a video you&apos;d post.</span>
            </h2>
            <p className="mt-5 text-lg text-muted-foreground">
              you film. it does the rest.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {teleprompterTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border bg-card px-4 py-2 font-mono text-sm text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Side by side ---------- */}
        <section id="compare" className="border-t border-border/60 bg-card/40">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <p className="kicker">side by side</p>
            <h2 className="mt-5 font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
              Same project. <span className="text-primary">One is slop.</span>
            </h2>

            <div className="mt-10 grid gap-5 md:grid-cols-2">
              {/* Bad */}
              <article className="rounded-2xl border border-border bg-card p-7">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  generic ai
                </p>
                <p className="mt-4 font-display text-xl leading-snug text-muted-foreground">
                  &ldquo;Hi everyone! Today I want to share a project I&apos;ve
                  been working on called Proof, an AI-powered platform that helps
                  developers…&rdquo;
                </p>
                <ul className="mt-6 grid gap-2.5 font-mono text-sm text-muted-foreground">
                  {[
                    "opens on a throat-clear",
                    '"platform," "powerful," "engaging"',
                    "recruiter already scrolled",
                  ].map((item) => (
                    <li key={item} className="relative pl-6">
                      <span className="absolute left-0 font-bold text-primary/70">
                        ×
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </article>

              {/* Good */}
              <article className="rounded-2xl border border-primary/40 bg-background p-7 shadow-sm">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                  proof
                </p>
                <p className="mt-4 font-display text-xl leading-snug text-foreground">
                  &ldquo;I spent the weekend making my AI app feel less like a
                  vibe-coded demo and more like an actual product. here&apos;s
                  the part that took three rewrites.&rdquo;
                </p>
                <ul className="mt-6 grid gap-2.5 font-mono text-sm text-muted-foreground">
                  {[
                    "opens on the real decision",
                    "names the mechanic, no filler",
                    "keywords flagged for overlays",
                  ].map((item) => (
                    <li key={item} className="relative pl-6">
                      <span className="absolute left-0 font-bold text-primary">
                        ✓
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </div>
        </section>

        {/* ---------- How it works ---------- */}
        <section id="how" className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <p className="kicker">how it works</p>
            <h2 className="mt-5 font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
              Repo in. <span className="text-primary">MP4 out.</span>
            </h2>

            <div className="mt-9 flex flex-wrap items-center gap-2">
              {pipeline.map((node, idx) => (
                <span key={node.label} className="flex items-center gap-2">
                  <span
                    className={
                      node.key
                        ? "rounded-lg border border-primary bg-primary px-3 py-2 font-mono text-sm font-medium text-primary-foreground"
                        : "rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-muted-foreground"
                    }
                  >
                    {node.label}
                  </span>
                  {idx < pipeline.length - 1 && (
                    <span className="font-mono text-muted-foreground" aria-hidden>
                      →
                    </span>
                  )}
                </span>
              ))}
            </div>

            <div className="mt-10 grid gap-8 md:grid-cols-3">
              <div className="border-l-2 border-primary pl-4">
                <p className="font-mono text-base font-bold text-primary">
                  OpenAI GPT-5.6
                </p>
                <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">
                  Luna handles structured extraction and drafting. Sol researches
                  current demand, ranks angles, authors scenes, and reviews the result.
                </p>
              </div>
              <div className="border-l-2 border-primary pl-4">
                <p className="font-mono text-base font-bold text-primary">
                  Whisper + FFmpeg
                </p>
                <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">
                  Word timestamps drive dead-space removal, cuts, captions, and
                  scene anchors without chopping speech mid-word.
                </p>
              </div>
              <div className="border-l-2 border-primary pl-4">
                <p className="font-mono text-base font-bold text-primary">
                  HyperFrames + Sol Vision
                </p>
                <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">
                  Bespoke motion graphics are rendered, composited over the real
                  footage, inspected across five frames, and repaired or omitted.
                </p>
              </div>
            </div>

            <LandingDemo />
          </div>
        </section>

        {/* ---------- Why us ---------- */}
        <section className="border-t border-border/60 bg-card/40">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <p className="kicker">why us</p>
            <h2 className="mt-5 max-w-[20ch] font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
              We&apos;re devs who never market our own work.
            </h2>
            <p className="mt-5 text-lg text-muted-foreground">
              so we built the thing that does it for us.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-12 gap-y-3 font-mono text-base">
              <span className="text-primary">Abel</span>
              <span className="text-primary">Abhishek</span>
              <span className="text-muted-foreground">built with Codex</span>
              <span className="text-muted-foreground">powered by OpenAI</span>
            </div>
          </div>
        </section>

        {/* ---------- Final CTA ---------- */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-5 py-24 text-center sm:px-8 md:py-32">
            <p className="kicker justify-center">demo</p>
            <h2 className="mx-auto mt-5 max-w-[18ch] font-display text-4xl font-medium leading-tight tracking-tight sm:text-6xl">
              The best version of you.{" "}
              <span className="text-primary">Posted.</span>
            </h2>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/connect"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 font-mono text-sm font-medium text-primary-foreground transition-all hover:translate-x-0.5 hover:brightness-105"
              >
                connect your repo <span aria-hidden>→</span>
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full border border-border px-7 py-3.5 font-mono text-sm text-foreground transition-colors hover:bg-muted"
              >
                log in
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ---------- Footer ---------- */}
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 font-mono text-xs text-muted-foreground sm:flex-row sm:px-8">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-[2px] bg-primary" />
            <span>Proof</span>
          </div>
          <p className="tracking-wide">You build. We get you seen.</p>
        </div>
      </footer>
    </div>
  );
}
