# Post-mortems

Failure modes that cost real time, written down so they are not repeated. Newest first.

---

---

## 2026-08-22: A full-page screenshot rendered the landing page empty, and it was the screenshot that was wrong

**What happened.** Verifying a landing-page design change, a Playwright `fullPage` screenshot came
back with the hero intact and **every section below it blank** — the ink section rendered as a solid
dark band with no text in it at all. The page looked catastrophically broken. It was not: the page
was fine in a browser the whole time.

**Why.** Sections below the fold are gated on `.reveal`, which is hidden by
`.reveal-ready .reveal { opacity: 0 }` until an `IntersectionObserver` adds `.is-visible` on scroll.
A `fullPage` screenshot expands the viewport and captures in one pass; the observer never fires for
content that was never scrolled through. The first attempt to fix it — scrolling the page in a loop
with 60ms pauses before shooting — did not work either, and produced the same empty page a second
time. Section *backgrounds* rendered normally throughout, which is what made it read as "the content
is gone" rather than "the capture is wrong".

**What made it recoverable.** The dark band was in the right place and the right colour. A genuinely
broken section would not have laid itself out correctly and then omitted only its text. That
mismatch was the tell that the tool was lying, not the page.

**The lesson.** This is the inverse of the 2026-08-08 entry below: there, a green signal hid a real
failure; here, a red signal was itself the artifact. Both come from trusting the harness instead of
the thing being measured. **Before believing a screenshot shows a bug, confirm the capture method
can even see a correct page** — for anything gated on scroll, animation, or an observer, drive it to
its finished state deterministically rather than trying to trigger it. Do not iterate on a fix for a
defect until the instrument has been shown to work.

**Fixed by** stripping the gate directly before capture rather than simulating scroll, which is the
same state a no-JS visitor gets:

```js
for (const el of document.querySelectorAll(".reveal-ready")) el.classList.remove("reveal-ready");
for (const el of document.querySelectorAll(".reveal")) el.classList.add("is-visible");
```

Any future full-page capture of `/` needs this, or it will report the same phantom breakage.

---

## 2026-08-08: The new pages returned 200, and the body was the login screen

**What happened.** `/privacy` and `/terms` shipped and were verified with an automated check that
fetched both, asserted `http 200`, and measured that neither overflowed a 390px viewport. Both
passed. Both were wrong: `isPublic()` did not list them, so the proxy redirected a signed-out visitor
to `/login`, and the login page returns 200. The check was reading a real HTTP success from the wrong
page.

It was caught by screenshotting the result and looking at it. The image was a sign-in form.

**Why the check could not see it.** Every assertion was about the response, not the content. Status
was 200 because a page rendered. Width was fine because the login page is also responsive. Nothing
compared what came back against what was supposed to come back. The page title was in the output the
whole time, reading "proof, get your github projects seen" rather than "Privacy - Proof", and it was
not asserted on.

**The lesson.** A status code proves a server answered, not that it answered with the thing you
asked for. Any check that a page "works" needs at least one assertion tied to that page's own
content. For anything visual, look at the render: the same screenshot pass later caught two deck
slides overflowing by 773px and 628px, which no status code would ever have revealed.

**Fixed by** adding `/privacy` and `/terms` to `PUBLIC_PREFIXES`, with a test that fails if either
stops being public, and by asserting on page title in the verification script.

---

## 2026-08-08: A gate that lied burned the budget the real review needed

**What happened.** The frozen-scene gate decided whether a scene animated by matching `.to(` in the
authored HTML. A reveal is idiomatically written `.from(".row", { opacity: 0 })`, so scenes that
visibly animated were reported as "0 real tweens - frozen" and re-authored against a defect that did
not exist. Tested against ordinary authoring styles, it reported frozen for timelines chained off
`gsap.timeline()`, chained `.from()` calls, CSS `@keyframes` and the Web Animations API - everything
except the one shape it was written against.

That alone would only waste model calls. The damage was structural: every gate shares one retry
budget, deterministic gates run before the render and the vision QA runs after it. Two false
positives consumed every attempt, so QA ran once, on the final iteration, with nothing left to
spend. On job `f68a8dab` its real finding - the Gradescope page cropped at the right edge - shipped
unfixed. The user saw an oversized, sliced screenshot and asked why QA had not caught it. QA had
caught it. It had nowhere to put the fix.

**Why it survived.** Its own tests passed, because they were written in the same `.to()` style as
the gate expected. A detector's tests must exercise the inputs it will actually see, not the inputs
its author had in mind.

**The lesson.** Whether something animates is a property of the rendered output, not of the source
text, and a regex cannot decide it. A false alarm that consumes a shared budget is worse than no
alarm: it crowds out the true one. Judge rendered artifacts by measuring them.

**Fixed by** deleting the gate (PR #36). The render immediately after used zero re-authors, against
5 in the run before, and total time fell to 465.8s from a 593.1s baseline.

---

## 2026-08-08: A readability floor made a faithful rebuild impossible

**What happened.** Screenshots were changed from cropped bitmaps to HTML reconstructions, and the
new instruction inherited a 56px minimum type size from the editorial-wording rules. For a rebuilt
interface that floor cannot be satisfied: the source page carries ~14px text across 1280px, so at
56px in a 1080px frame roughly 18% of the page fits. Every faithful rebuild had to overflow. The
result was an enormous screenshot sliced on all four sides, sidebar cut mid-word, floating labels
overlapping the content.

**Why it happened.** The crop rules it replaced held the same contradiction - "show LESS of the
image and scale further" alongside "nothing may be clipped at a frame edge" - and the replacement
reproduced it in different words. The mechanism changed; the impossible pair of constraints did not.

**A second-order version of the same mistake.** The first repair said "content you cannot fit is
content to leave out rather than to overflow". The following render produced text-free placeholder
cards where the previous one had shown real labels: the model read a sizing instruction as licence
to drop content. Reworded to "scale the whole thing down until it fits - zoom out, do not drop
content".

**The lesson.** Before writing a constraint, check it is satisfiable with arithmetic. Two rules that
each sound reasonable can be jointly impossible, and a model told to satisfy both will oscillate
between violating one and violating the other, which reads as incompetence rather than as a
contradiction in the brief.

---

## 2026-08-08: The densest screenshot silently lost both its caption and its text

**What happened.** Upload-time extraction was capped at 2000 output tokens. The busiest screenshot -
the deadline panel, the one the whole feature exists for - overran it, the JSON truncated mid-string,
`JSON.parse` threw, and the catch returned an empty caption and no record. It had had a working
caption before the change, so the most important image was made strictly worse, and silently: four
of five images looked fine.

**How it was found.** Re-uploading through the live UI and counting records, not by a test. Nothing
in the suite could see it, because the failure needed a real screenshot dense enough to overrun a
real token cap.

**Fixed by** raising the cap to 8000 (the same image now completes in 2681 tokens) and salvaging
truncated replies: the caption is emitted first so it survives, whole items up to the cut are kept,
and the partial one at the end is dropped. A half-read row is exactly what must never reach a scene.

**The lesson.** A catch-all that degrades to "no data" hides the failures that matter most, because
the inputs that break a limit are the inputs that matter most. Degrade partially, and log it.

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
`pinnedHttpsRequest` â€” the one function containing the bug â€” was never executed by any test. The
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

**Impact.** Production renders completed successfully and shipped with **zero bespoke animations** â€”
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
   output. That 12-bit â†’ 8-bit rgba â†’ 10-bit chain **crashes ffmpeg 5.1** (exit 139 / SIGSEGV,
   deterministically reproducible). `maskOverlaySafeZones` only runs for `mode === "overlay"`
   (`render/src/premium/index.ts`), so the crash silently killed **every overlay-mode scene** while
   full-frame scenes rendered fine â€” which reads as "half the animations are missing".

**The real mistake: a proxy was accepted as proof.**

The deploy was declared verified because the worker's boot line looked healthy:

```
proof render service listening on 0.0.0.0:8080 (token-required, max 2 concurrent renders, mode generated-experimental)
```

That line proves the process started and the **HyperFrames CLI is importable**. It proves nothing about
whether a *browser* exists. Worse, `hyperframesAvailable()` only calls `require.resolve` â€” and that
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
| OOM / memory contention between parallel ProRes composites (the "exactly one scene per pair dies" pattern looked convincing) | cgroup: `oom_kill 0`, peak **5.2 GB of a 24 GB** limit. Never memory. The pattern was coincidence â€” the dying scenes were the *overlay-mode* ones. |
| Node killing the child over a `maxBuffer` limit | `ffmpeg.ts` uses `spawn`, not `exec`. `spawn` has no maxBuffer. |

Both were plausible stories built on partial evidence. The answer arrived in one step once the failing
command was **run by hand inside the production container** and printed `Segmentation fault`.

**Rules taken from this.**

1. **A deploy is not verified until a real render's frames have been looked at.** Not a boot log, not a
   health check, not a passing test suite. Download the MP4, extract frames, look at them.
2. **`hyperframesAvailable()` does not mean HyperFrames works.** It checks that the CLI resolves. The
   browser is a separate, independent requirement. Same trap applies to any "is X installed" preflight.
3. **Reproduce before theorising.** When a child process dies with exit code `null`, that is a signal
   kill â€” get the signal (`echo $?` â†’ 139 = SIGSEGV) and re-run the exact command in the real
   environment. Two wrong hypotheses cost more time than the reproduction did.
4. **Exonerate by diff, not by vibe.** "The last change broke it" is the default assumption and was
   wrong here. `git log -S "<symbol>"` proved `unzip` and `hyperframes browser ensure` had *never*
   existed in the Dockerfile, which settled blame in one command.
5. **Both renderers need their own browser provisioned at build time.** Never rely on a runtime
   download inside a container.

**References.** `render/Dockerfile`, `render/src/ffmpeg.ts` (`SPEAKER_SAFE_ALPHA_FILTER`),
`render/src/premium/index.ts` (mask call site), `render/src/premium/fallback.ts`, PR #18,
`DECISIONS.md` 2026-07-29.

