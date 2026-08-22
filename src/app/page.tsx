import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { ProofMark } from "@/components/proof-mark";
import { LandingDemo } from "@/components/landing-demo";
import { Reveal } from "@/components/reveal";
import Link from "next/link";

/** Inline `--stagger` custom property for the entrance/reveal animations. */
const stagger = (ms: number): CSSProperties => ({ "--stagger": `${ms}ms` } as CSSProperties);

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

          <nav className="hidden items-center gap-8 font-mono text-xs text-muted-foreground md:flex">
            <a href="#problem" className="transition-colors hover:text-foreground">
              Problem
            </a>
            <a href="#how" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#compare" className="transition-colors hover:text-foreground">
              Side by side
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="#demo"
              className="hidden rounded-full px-4 py-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              Demo
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center rounded-full bg-primary px-5 py-2 font-mono text-xs font-medium text-primary-foreground transition-all hover:brightness-105 active:translate-y-px"
            >
              Log in
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="relative overflow-hidden">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 sm:px-8 md:py-28 lg:grid-cols-[0.92fr_1.08fr] lg:py-32">
            <div>
              <p className="enter mb-5 font-mono text-xs text-primary" style={stagger(0)}>
                OpenAI Build Week · GPT-5.6 + Codex
              </p>
              <h1 className="enter font-display text-5xl font-medium leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl" style={stagger(90)}>
                Turn your GitHub work into a video people
                <span className="text-primary"> watch.</span>
              </h1>

              <p className="enter mt-7 max-w-md text-lg leading-relaxed text-muted-foreground" style={stagger(190)}>
                <span className="font-medium text-foreground">
                  Writing code is cheap now. Distribution is the moat.
                </span>{" "}
                Proof researches the angle, writes the brief, gives you a
                teleprompter, cuts the take, and authors the graphics. You choose
                the story and record it.
              </p>

              <div className="enter mt-9 flex flex-wrap items-center gap-4" style={stagger(280)}>
                <Link
                  href="/connect"
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-mono text-sm font-medium text-primary-foreground transition-all hover:translate-x-0.5 hover:brightness-105"
                >
                  connect your repo <span aria-hidden>→</span>
                </Link>
                <Link
                  href="#demo"
                  className="inline-flex items-center gap-2 font-mono text-sm text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                >
                  or try it yourself, no account
                </Link>
              </div>

              <p className="enter mt-10 font-mono text-sm text-muted-foreground" style={stagger(360)}>
                your repo proves you built it.
                <span className="font-medium text-primary"> nobody outside GitHub reads it.</span>
              </p>

              {/* Beta users asked this unprompted, twice. Say it before they have to wonder. */}
              {/* Sans, not mono: this is prose. Mono is for labels and code. */}
              <p className="enter mt-4 max-w-md text-[13px] leading-relaxed text-muted-foreground/80" style={stagger(420)}>
                Proof reads your README, file names and language stats. It never reads your source
                code, and the README is used to write your script, not stored.
              </p>
            </div>

            <div className="enter" style={stagger(220)}>
              <LandingDemo />
            </div>
          </div>
        </section>

        {/* ---------- Problem ---------- */}
        <section
          id="problem"
          className="border-t border-border/60 bg-card/40"
        >
          <Reveal className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <p className="kicker">the problem</p>
            <h2 className="mt-5 max-w-[16ch] font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
              Projects don&apos;t die because they&apos;re bad.
              <br />
              <span className="text-primary">They die because nobody sees them.</span>
            </h2>

            <ul className="mt-10 grid max-w-2xl gap-5">
              {[
                <>
                  Shipping is easy now. Getting people to{" "}
                  <span className="font-semibold text-foreground">use</span> it
                  isn&apos;t.
                </>,
                <>
                  Traction comes from marketing, not from the code being good.
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
              So the best work goes unseen,{" "}
              <span className="text-primary">and no one ever hears about you.</span>
            </p>
          </Reveal>
        </section>

        {/* ---------- Why now (the insight beat) ---------- */}
        <section id="why-now" className="border-t border-border/60">
          <Reveal className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <p className="kicker">why now</p>
            <h2 className="mt-5 max-w-[20ch] font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
              Everyone can build now.
              <br />
              <span className="text-primary">Almost nobody can get seen.</span>
            </h2>

            <div className="mt-10 grid max-w-3xl gap-6 sm:grid-cols-2">
              <p className="text-lg leading-relaxed text-muted-foreground">
                AI collapsed the cost of shipping. A weekend gets you a working product, so a working
                product stopped being the thing that sets you apart.
              </p>
              <p className="text-lg leading-relaxed text-muted-foreground">
                What did not get cheaper is attention. The bottleneck moved, and it moved to the one
                job most developers will not do for themselves.
              </p>
            </div>

            <p className="mt-10 max-w-[26ch] font-display text-2xl font-medium leading-tight tracking-tight sm:text-3xl">
              Writing code is cheap now.{" "}
              <span className="text-primary">Distribution is the moat.</span>
            </p>
          </Reveal>
        </section>

        {/* ---------- What it is ---------- */}
        <section className="border-t border-border/60">
          <Reveal className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
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
          </Reveal>
        </section>

        {/* ---------- Side by side ---------- */}
        <section id="compare" className="border-t border-border/60 bg-card/40">
          <Reveal className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <p className="kicker">side by side</p>
            <h2 className="mt-5 font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
              Same project. <span className="text-primary">One gets watched.</span>
            </h2>

            <div className="mt-10 grid gap-5 md:grid-cols-2">
              {/* Bad */}
              <article className="rounded-2xl border border-border bg-card p-7">
                <p className="font-mono text-xs text-muted-foreground">
                  how devs write it
                </p>
                <p className="mt-4 font-display text-xl leading-snug text-muted-foreground">
                  &ldquo;I built a CLI that parses OpenAPI specs and generates
                  typed clients with full runtime validation.&rdquo;
                </p>
                <ul className="mt-6 grid gap-2.5 text-[15px] leading-relaxed text-muted-foreground">
                  {[
                    "technically correct, zero reason to care",
                    "opens on the what, never the why",
                    "scrolled past in half a second",
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
                <p className="font-mono text-xs text-primary">
                  what proof writes
                </p>
                <p className="mt-4 font-display text-xl leading-snug text-foreground">
                  &ldquo;I got tired of hand-writing the same API client every
                  time the backend changed. So I made it generate itself.&rdquo;
                </p>
                <ul className="mt-6 grid gap-2.5 text-[15px] leading-relaxed text-muted-foreground">
                  {[
                    "opens on the problem you actually had",
                    "one idea, said like a person",
                    "keywords flagged for on-screen overlays",
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
          </Reveal>
        </section>

        {/* ---------- How it works ---------- */}
        <section id="how" className="border-t border-border/60">
          <Reveal className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
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

            {/* Numbered, not accent-barred: this is a sequence, so the numeral
                carries the structure and earns its place as content. */}
            <div className="mt-10 grid gap-8 md:grid-cols-3">
              {[
                {
                  n: "01",
                  title: "OpenAI GPT-5.6",
                  body: "Luna handles structured extraction and drafting. Sol researches current demand, ranks angles, authors scenes, and reviews the result.",
                },
                {
                  n: "02",
                  title: "Whisper + FFmpeg",
                  body: "Word timestamps drive dead-space removal, cuts, captions, and scene anchors without chopping speech mid-word.",
                },
                {
                  n: "03",
                  title: "HyperFrames + Sol Vision",
                  body: "Bespoke motion graphics are rendered, composited over the real footage, inspected across five frames, and repaired or omitted.",
                },
              ].map((step) => (
                <div key={step.n} className="border-t border-border pt-5">
                  <p className="font-mono text-sm text-primary">{step.n}</p>
                  <p className="mt-3 font-mono text-base font-bold text-foreground">
                    {step.title}
                  </p>
                  <p className="mt-2 text-base leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>

          </Reveal>
        </section>

        {/* ---------- Why us ---------- */}
        <section className="border-t border-border/60 bg-card/40">
          <Reveal className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
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
          </Reveal>
        </section>

        {/* ---------- Final CTA ---------- */}
        <section className="border-t border-border/60">
          <Reveal className="mx-auto max-w-6xl px-5 py-24 text-center sm:px-8 md:py-32">
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
          </Reveal>
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
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-foreground">
              terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
