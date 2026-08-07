# Post-mortems

Failure modes that cost real time, written down so they are not repeated. Newest first.

---

## 2026-08-07: Every premium asset download failed on Node 22, and the suite stayed green

**What happened.** No user screenshot or logo had ever reached a generated scene in production. Each
download threw `Invalid IP address: undefined` from `emitLookup`, the premium engine caught it and
fell back to generic overlays, and the video still shipped. Nothing errored where anyone would see it.
It was found only by running the worker's real fetch path by hand against a real storage URL while
investigating why scenes looked generic.

**The bug.** `pinnedHttpsRequest` overrides `https.request`'s `lookup` so the socket connects to an
address already checked against private ranges, closing a DNS-rebinding window. The shim always called
back with a bare address string. Node 22's agent calls `lookup` with `{ all: true }` on some paths, and
per Node's contract that requires an ARRAY of `{ address, family }`. Node read `.address` off a string,
got `undefined`, and threw. The production image is `node:22-bookworm-slim`, the same major version.

**Why every test passed.** `render/tests/asset-source.test.ts` injects a fake `request` dependency.
`pinnedHttpsRequest` — the one function containing the bug — was never executed by any test. The
DNS-rebinding test asserted the *policy* while mocking away the *mechanism*. Dependency injection made
the failure paths testable and simultaneously created a hole exactly the shape of the untested seam.

**Cost.** Unknown duration of degraded output. Worse, the degradation was invisible: "the engine used
generic graphics" is indistinguishable from "the model chose generic graphics", so it read as a
quality problem rather than a bug, and quality problems get prompt-tuned instead of debugged.

**Lessons.**

- **An injected boundary needs one test that does not inject.** If every test replaces the transport,
  the transport is unverified. Ship a probe that exercises the real socket.
  `render/scripts/probe-asset-fetch.ts` now does this against public storage and needs no credentials.
- **Silent degradation is worse than a crash.** The fallback path made a hard failure look like a soft
  preference. A fallback that hides a systematic error should count the failures and surface them.
- **Prove a fix by reverting it.** The regression test was confirmed by restoring the old one-line shim
  and watching two tests fail, then restoring the fix and watching 110 pass. A test that has never been
  seen to fail is not yet a regression test.
- **Reproduce a library-contract bug against the real library.** The controlled experiment changed only
  whether the shim honoured `options.all`; everything else was held constant. That is what turned a
  plausible theory into a confirmed cause.

**References:** `render/src/premium/asset-source.ts` (`pinnedLookup`),
`render/tests/pinned-lookup.test.ts`, `render/scripts/probe-asset-fetch.ts`, PR #29.

---

## 2026-08-01: A full green gate sat next to a live auth bypass for weeks

**Impact.** Anyone with a Google account could grant themselves beta access, a profile and 1000
credits, by setting one field on their own auth record. It was live in production and had been for
as long as `isAllowlisted` existed. Nobody found it, and forensics confirmed nobody used it (0 of 13
profiles were off the allowlist), so the cost was zero by luck rather than by process.

**What happened.** `isAllowlisted` interpolated the GitHub handle straight into a PostgREST `.or()`
filter. That handle came from `user.user_metadata.user_name`, which Supabase lets the user write
themselves. `x,id.not.is.null` turned the allowlist check into a filter that matches every row.

The bug was found only because a change **near** it was flagged as security-sensitive and put through
an adversarial review. The change itself was fine. The code it sat beside was not.

**The uncomfortable part.** At the moment the review ran, the branch had: 121 unit tests passing,
`tsc` clean, `lint` clean, a passing production build, and rendered screenshots checked at two
viewports. Every gate was green. None of them were capable of finding this, because every one of
them checks what somebody already thought to ask.

**Lessons.**

1. **Tests confirm your assumptions; they cannot audit them.** A test suite is a record of the
   failure modes you imagined. It is structurally incapable of surfacing the ones you did not. Green
   means "no known regression", never "no vulnerability".
2. **Trace every identity signal to who can write it.** The bug was not really string interpolation,
   it was treating an attacker-writable field as an identity claim. Escaping the value would have
   closed the injection and left impersonation wide open. Ask "who controls this?" before "is this
   escaped?".
3. **Reviewing a diff means reviewing what the diff touches.** The vulnerability was not in the
   change under review; it was in the function that change made easier to reach. Scope the review to
   the blast radius, not the patch.
4. **Reproduce a reported vulnerability before fixing it, and after.** A read-only query against
   production turned "the reviewer says this is exploitable" into "here is the row it returns", and
   the same query afterwards proved the fix without guessing. It also proved the fix did not break
   legitimate access, which is the half that is easy to skip.
5. **Run an adversarial pass on anything touching auth, credits or the allowlist**, rather than when
   somebody remembers to ask for one. This one was requested by the founder, not by process. That is
   the actual gap.

**References:** [DECISIONS.md](DECISIONS.md) 2026-08-01, PR #24, `tests/allowlist.test.ts`.

---


## 2026-07-29: A deploy was called "verified" off a boot log, and shipped 0-animation videos

**Impact.** Production renders completed successfully and shipped with **zero bespoke animations** —
captions only. The founder testing it saw "the video now has 0 animations" and reasonably assumed the
most recent change (removing the music feature) had broken the pipeline. Roughly a day of
back-and-forth went into a bug that a 10-minute check would have caught before anyone noticed.

**What was actually broken (two independent faults, neither related to the music removal).**

1. **HyperFrames had no browser.** `render/Dockerfile` pre-warmed only *Remotion's*
   chrome-headless-shell. Remotion and HyperFrames keep their browsers in **separate** caches
   (`/app/node_modules/.remotion/...` vs `/home/node/.cache/hyperframes/...`). HyperFrames therefore
   cold-downloaded Chrome on every render, and that download cannot extract without a system zip
   archiver: `unzip` was not installed, and `yauzl` (hyperframes' JS fallback) is an **optional peer
   dependency** that npm does not install by default. With `volumeMounts: []` there is no cache to
   survive a restart either. Net effect: **production could never render a bespoke scene, ever.** It
   only looked like it worked because the founder rendered locally, where a system Chrome exists.
2. **The speaker-safe mask segfaulted ffmpeg.** `SPEAKER_SAFE_ALPHA_FILTER` ran
   `format=rgba,drawbox=...,format=yuva444p10le` over HyperFrames' ProRes 4444 **yuva444p12le**
   output. That 12-bit → 8-bit rgba → 10-bit chain **crashes ffmpeg 5.1** (exit 139 / SIGSEGV,
   deterministically reproducible). `maskOverlaySafeZones` only runs for `mode === "overlay"`
   (`render/src/premium/index.ts`), so the crash silently killed **every overlay-mode scene** while
   full-frame scenes rendered fine — which reads as "half the animations are missing".

**The real mistake: a proxy was accepted as proof.**

The deploy was declared verified because the worker's boot line looked healthy:

```
proof render service listening on 0.0.0.0:8080 (token-required, max 2 concurrent renders, mode generated-experimental)
```

That line proves the process started and the **HyperFrames CLI is importable**. It proves nothing about
whether a *browser* exists. Worse, `hyperframesAvailable()` only calls `require.resolve` — and that
exact limitation had been written into `render/src/premium/fallback.ts` days earlier, in a comment, by
the same person who then ignored it. **The check was known to be insufficient and was used anyway.**

`AGENTS.md` already carried the rule that would have caught this:

> - For render changes, inspect actual output frames or video, not only generated HTML.
> - For deployed changes, verify the live route and provider logs.

So this was not a missing rule. It was a rule skipped because a green-looking log felt like enough.

**Second mistake: guessing instead of reproducing.** Two wrong root causes were asserted before the
real one was found:

| Guess | How it was actually disproved |
|---|---|
| OOM / memory contention between parallel ProRes composites (the "exactly one scene per pair dies" pattern looked convincing) | cgroup: `oom_kill 0`, peak **5.2 GB of a 24 GB** limit. Never memory. The pattern was coincidence — the dying scenes were the *overlay-mode* ones. |
| Node killing the child over a `maxBuffer` limit | `ffmpeg.ts` uses `spawn`, not `exec`. `spawn` has no maxBuffer. |

Both were plausible stories built on partial evidence. The answer arrived in one step once the failing
command was **run by hand inside the production container** and printed `Segmentation fault`.

**Rules taken from this.**

1. **A deploy is not verified until a real render's frames have been looked at.** Not a boot log, not a
   health check, not a passing test suite. Download the MP4, extract frames, look at them.
2. **`hyperframesAvailable()` does not mean HyperFrames works.** It checks that the CLI resolves. The
   browser is a separate, independent requirement. Same trap applies to any "is X installed" preflight.
3. **Reproduce before theorising.** When a child process dies with exit code `null`, that is a signal
   kill — get the signal (`echo $?` → 139 = SIGSEGV) and re-run the exact command in the real
   environment. Two wrong hypotheses cost more time than the reproduction did.
4. **Exonerate by diff, not by vibe.** "The last change broke it" is the default assumption and was
   wrong here. `git log -S "<symbol>"` proved `unzip` and `hyperframes browser ensure` had *never*
   existed in the Dockerfile, which settled blame in one command.
5. **Both renderers need their own browser provisioned at build time.** Never rely on a runtime
   download inside a container.

**References.** `render/Dockerfile`, `render/src/ffmpeg.ts` (`SPEAKER_SAFE_ALPHA_FILTER`),
`render/src/premium/index.ts` (mask call site), `render/src/premium/fallback.ts`, PR #18,
`DECISIONS.md` 2026-07-29.
