# proof — Architectural Decision Records

**Append-only.** Never delete entries. If a decision is reversed, add a NEW entry referencing the old one.

Format: `## YYYY-MM-DD: Short title` → Context → Decision → Alternatives considered → Consequences → References.

For **what proof is** → [README.md](README.md)
For **the render service** → [render/README.md](render/README.md)
For **project rules** → [AGENTS.md](AGENTS.md)

---

## 2026-07-10: Cap concurrent renders at 2 (env-tunable), don't run unbounded

**Status:** The concurrency decision remains active. The original in-memory job-state caveat was
superseded by durable `render_jobs` storage and restart recovery in `4bb7be2`.

**Context:** the render service (`render/`) runs on a single Railway box (24 vCPU / 24 GB). `POST /render` fired `runJob` immediately with no queue or limit — so N simultaneous requests started N heavy renders at once. A render is CPU-bound (Remotion parallelizes frames across all cores) and holds a large transparent ProRes overlay in memory during the ffmpeg composite. Concern raised before the SUTD demo: if a room of students taps "render" in the same window, the box thrashes and renders fail live.

**Decision:** gate renders behind an async semaphore (`render/src/semaphore.ts`), cap = `RENDER_CONCURRENCY` env var, **default 2**. Excess jobs stay in the existing `queued` status until a slot frees, instead of all starting together. Env-tunable so the cap can be dropped to 1 from the Railway dashboard (a ~15s restart) without a code change + Docker rebuild — an emergency knob if it thrashes live.

**The number is measured, not guessed.** Load-tested the live box 2026-07-10 (concurrent 15s renders, `render/tmp/loadtest.ts`):

| Concurrent | Result | Avg time/job |
|---|---|---|
| 1 | 1/1 ok | 34.4s |
| 2 | 2/2 ok | 27.6s |
| 3 | **2/3 — one failed** | ffmpeg OOM |

- **1 render already saturates the CPU**, so concurrency doesn't multiply throughput — it splits the same cores.
- **2 is faster per-job than 1** (27.6s vs 34.4s) because a job spends seconds idle on network I/O (whisper transcription, Supabase upload) where a second job's compute fills the gap. Better utilization, still under the memory ceiling.
- **3 OOMs the composite.** The failed job died with `ffmpeg exited 1: Failed to inject frame into filter network: Resource temporarily unavailable` (confirmed in Railway logs) — memory exhaustion with three ProRes overlays in flight.

**Alternatives considered:**
- **Cap 1** — safe, but wastes the idle-I/O window and is slower per job. Rejected as the default; kept as the emergency fallback via the env var.
- **Cap 3+ / unbounded** — rejected, measured to drop jobs (OOM).
- **Horizontal scale (multiple render replicas / autoscaling)** — the correct answer for real simultaneous scale, but real infra + cost. Overkill for a hackathon demo with dozens of users trickling in. Deferred.
- **A real job queue (e.g. Trigger.dev, which the original stack used)** — heavier; the in-process semaphore is enough for one box. Deferred.

**Consequences:** excess renders wait rather than crash; `queued` status is meaningful. Server
logs the cap at startup. The measurement used 15-second clips, so a 60-second workload may need
the cap dropped to 1. Durable jobs now survive worker restarts, but an errored job still requires
an explicit resubmission.

**References:** `render/src/semaphore.ts`, `render/src/server.ts` (`renderGate`),
`render/tests/semaphore.test.ts`, and PR [#1](https://github.com/abel123code/proof/pull/1).

---

## 2026-07-21: Make vision-reviewed scenes the operator-owned default

**Context:** The browser sent `editMode: "brief-driven"`, which bypassed the premium author and
vision gate even when the legacy `premium` boolean was enabled. A live SUTD fixture exposed a
second failure: fixed keyword chips were already burned into the captioned base. Vision QA
correctly rejected the chip for entering the protected head zone, then sent an impossible repair
to the scene author because the author did not own that base layer. Review found the same issue
for fixed text-card overlays.

**Decision:** The Next.js route and render worker own render mode and default to
`generated-experimental`. Client mode fields are ignored at both boundaries. Operators can set
`RENDER_EDIT_MODE` to `brief-driven` or `classic` on both services. Premium mode omits fixed
keyword chips and text-card overlays, masks authored alpha over the moving-speaker and caption
zones, then submits five composited frames to GPT-5.6 Sol at original detail. Rejected reasons
feed the next author attempt. Parsing remains fail closed, and vision QA has no runtime bypass.
Model-authored HTML still passes the sanitizer before rendering.

Premium OpenAI requests use a 90-second per-attempt timeout and one retry. This gives one chance
to recover from a connection reset while bounding the SDK retry window.

Programmatic Tool Calling is excluded from this loop because each vision verdict changes the
next author request. Independent scenes still run concurrently behind the cap of two.

**Alternatives considered:**

- Keep premium as a client flag. Rejected because stale clients can silently bypass QA.
- Loosen or disable QA. Rejected after visual inspection confirmed the reported face overlap,
  clipped wordmark, and empty transition.
- Rely on coordinate instructions alone. Rejected after Sol repeated the same protected-zone
  violation across two repair prompts.
- Let QA review fixed keyword chips. Rejected because the author cannot repair a graphic already
  present in the base video.

**Consequences:** Premium mode has fewer fixed overlays, a deterministic face-safety floor, and a
useful adaptive repair loop. Scenes can still be rejected for clipping, weak contrast, wrong
copy, empty frames, or poor design after masking. Full rendering remains slow.

**Evidence:** On 2026-07-21, an eight-second real fixture completed in 397 seconds. QA rejected
two scene variants, approved the second repair, and the final 1080x1920 MP4 differed from the
caption-only base. See `render/src/job.ts`, `render/src/ffmpeg.ts`,
`render/src/premium/index.ts`, `render/src/premium/qa.ts`, and the tests in `render/tests/`.

---

## 2026-07-23: QA is an auditable advisor — scenes ship flagged, never silently omitted

**Status:** Active. Supersedes the "rejected scenes are repaired or omitted" behaviour of the
2026-07-22 editorial-QA entry above (which is otherwise unchanged: no erase-mask, deterministic
caption check, editorial vision QA, patch-not-reroll retries).

**Context:** A frozen-fixture retest (2026-07-23) shipped only 2 of 5 scenes. Eyeballing the three
omitted scenes showed the omissions were mostly *wrong*: scene-2 and scene-5 were face-clear,
caption-clear and shippable but were deleted for **subjective** reasons — an unrealized creative
beat, and a two-word badge copy ORDER ("PROOF EDITED BY" vs "EDITED BY PROOF"). Worse, the pipeline
ran ~30 min and then showed the user *nothing* for those beats, with no reason surfaced — a black box
that silently drops work. The product bar (stated by the founder, citing Voltade's auditable-agent
model): every agent action must be auditable — the user must see *why*, and *the human* decides
whether to re-render, especially for anything subjective.

**Decision:** QA becomes an **auditable advisor**, not a silent gatekeeper.
- Each QA finding is tagged `safety` (objective: missing/clipped/unreadably small required wording,
  graphic in the caption band, garbled text, duplicated captions, broken render, missing required asset) or
  `subjective` (creative/copy/polish — a matter of taste). When unsure, default to `subjective`.
- **A scene is never silently omitted.** `safety` faults drive an auto-patch up to the retry budget;
  if still unresolved, the scene **ships FLAGGED** (the founder chose ship-it-flagged over base
  fallback). `subjective` notes NEVER block and NEVER drive a re-author — they ride along as flags.
- Every scene carries a `SceneReport` (`verdict` clean|flagged|base_fallback, `shipped`, tagged
  `issues`, `attempts`). `runPremium` returns the reports and writes `scene-report.json`; the app
  surfaces each scene's verdict + reasoning and asks the user, per scene, whether to re-render.
- The captioned base is the per-scene fallback (`base_fallback`) only when a scene cannot be
  rendered safely at all (HTML fails the security validator) — the one true non-ship case.
- Bumping the retry budget was explicitly REJECTED as the fix: it adds latency to a black box the
  user already can't see into. The fix is auditability + human control, not more silent retries.

**Alternatives considered:**
- Keep omitting, just loosen the QA rubric. Rejected — still silent, still no reasoning, and a
  loosened bar ships genuine safety faults unflagged.
- Fall back to captions-only for a failed beat. Rejected as the default (the founder chose
  ship-it-flagged) but kept as the `base_fallback` for the unrenderable-HTML case.
- Bump `PREMIUM_MAX_QA_ITERS`. Rejected (see above).

**Consequences:** Every scene ships with a machine-readable audit record; nothing is dropped without
a visible reason. The web app can render a per-scene "here's what QA flagged — re-render?" review
step. A flagged scene may ship with an unresolved safety issue (by design — the human decides), so
the flag MUST be surfaced. Remaining work: persist `SceneReport` with the render job and build the
studio review UI + a per-scene re-render endpoint. See `render/src/types.ts` (`SceneIssue`,
`SceneReport`), `render/src/premium/index.ts` (`produceScene`, `runPremium`),
`render/src/premium/qa.ts`, and `render/tests/premium.test.ts`.

---

## 2026-07-24: One visual authority per beat; captions composite last

**Status:** Active.

**Context:** A frame-by-frame comparison against a founder-edited creator video showed that graphic
frequency was not the main quality problem. The reference used graphics through most of its runtime,
but separated visual modes: clean talking head, one supporting overlay, or a full-frame explanation.
Proof instead instructed every scene to build chips, dashboards, panels, timelines, and waveforms
around the face. Full-frame animation was also structurally impossible because premium scenes were
transparent, speaker-masked overlays composited after captions.

**Decision:**

- GPT-5.6 Sol produces one global typed edit plan before scene authoring. The plan assigns `overlay`
  or `full-frame`; timeline gaps intentionally remain clean A-roll.
- TypeScript enforces the editorial budget: at least 25% clean runtime, no more than 40% full-frame,
  no more than 35% overlay, face-led opening/closing, recovery after full-frame sequences, and one
  three-second clean interval in videos over 30 seconds.
- Every scene receives one shared creative direction. Continuity comes from palette, typography,
  spacing, motif, and transition grammar, not mandatory dashboard chrome.
- Overlay scenes receive a deterministic caption-band alpha mask and always keep footage visible.
  Face overlap is allowed because readable mobile-sized wording takes priority over preserving every face feature.
  Full-frame scenes independently select `footage` or `black`: black is reserved for animation that
  occupies most of the frame or must be the sole focus.
  The compositor supplies the black background, so authored HTML remains transparent in both cases.
- QA reviews the selected background treatment. A black takeover treats the absent speaker as
  intentional; footage-backed scenes allow face overlap and treat missing, clipped, or sub-56px essential
  wording as an objective repair fault.
- Composition order is clean footage -> creator visuals -> captions. QA reviews the same order.
- A planner decision to use zero enhanced scenes is valid clean A-roll, not a premium failure.

**Consequences:** HyperFrames can now own the complete frame when the visual carries the explanation,
while short supporting graphics remain singular and speaker-led. Captions remain readable because they
are composited last. `SceneReport` adds the selected mode, background treatment, and rationale, while
`edit-plan.json` records coverage and clean intervals. The public render brief and database schema do
not change.

---

## 2026-07-29: Both renderers get their browser baked in; the alpha mask never touches rgba

**Status:** Active. Two hard environment constraints for the render image, both learned from a
production outage that shipped 0-animation videos. Full narrative in `POST_MORTEMS.md` (2026-07-29).

**Context.** Production renders were completing and shipping with **zero bespoke scenes**. Two
independent faults, both latent since the premium engine landed:

1. `render/Dockerfile` pre-warmed only **Remotion's** chrome-headless-shell. Remotion and HyperFrames
   keep browsers in **separate** caches (`/app/node_modules/.remotion/...` vs
   `/home/node/.cache/hyperframes/...`), so HyperFrames cold-downloaded Chrome on every render. That
   download needs a system zip archiver: `unzip` was absent and `yauzl` is an **optional peer
   dependency** npm skips. With no Railway volume (`volumeMounts: []`) nothing cached between
   restarts, so **prod could never render a scene**. It appeared to work only because the team
   rendered locally, where a system Chrome exists.
2. `SPEAKER_SAFE_ALPHA_FILTER` ran `format=rgba,drawbox=...,format=yuva444p10le` over HyperFrames'
   ProRes 4444 **yuva444p12le** output. That 12-bit to 8-bit to 10-bit chain **segfaults ffmpeg 5.1**
   (exit 139, reproducible on any scene mov). The mask only runs for `mode === "overlay"`, so it
   silently killed **every overlay scene** while full-frame scenes rendered — reading as "half the
   animations are missing".

**Decision.**

- The image **provisions both browsers at build time**: `npx remotion browser ensure` *and*
  `npx hyperframes browser ensure`, with `unzip` installed. No render may depend on a runtime browser
  download. Removing either line silently disables an entire renderer.
- `SPEAKER_SAFE_ALPHA_FILTER` **converts straight to `yuva444p10le` and draws there**. It must never
  route through `format=rgba`. A regression test (`render/tests/ffmpeg-filter.test.ts`) asserts the
  filter contains no `rgba`. The rgba hop was also silently discarding alpha precision.

**Alternatives considered.**

- *Point `HYPERFRAMES_BROWSER_PATH` at a system Chrome.* Rejected: the slim base image ships only
  chromium **libraries**, not a browser binary, so this would need a heavier apt install.
- *Add `yauzl` as an explicit dependency* so the runtime download can extract. Rejected as the primary
  fix — it still leaves a network dependency mid-render. Baking the browser is strictly better.
- *Mount a Railway volume to cache the browser.* Rejected: solves caching, not the first cold start,
  and adds state to a stateless worker.
- *Drop the caption-band mask entirely* (caption-guard already relocates intruding graphics). Deferred
  — plausible per the 2026-07-23 advisor ADR, but it removes a safety net and was out of scope for an
  outage fix. Revisit deliberately.

**Consequences.** Docker builds are slower and the image is about 115 MB larger (a second headless
shell). Verified in the production container: chrome binary present, `unzip` present,
`chrome-headless-shell --version` returns, and the previously-segfaulting command exits 0. A real
production render went from **0/6 scenes shipped to 5/5, 0 base-fallback**.

**A deploy is not verified by a boot log.** `hyperframesAvailable()` only checks the CLI resolves; it
cannot see the browser. Verification means downloading the rendered MP4 and inspecting frames. See
`AGENTS.md` "Definition of done" and `POST_MORTEMS.md`.

**References:** `render/Dockerfile`, `render/src/ffmpeg.ts`, `render/src/premium/index.ts` (mask call
site), `render/tests/ffmpeg-filter.test.ts`, PR #18.

---

## 2026-07-31: Private repos via a scoped GitHub App, and Proof never reads source code

**Status:** Active. Shipped in PRs #19 and #20.

**Context.** `src/lib/github.ts` used a single shared server token, so Proof could only ever see
public repositories. Private access was not a missing feature, it was excluded by the auth
architecture. Most real startups keep their code private, which capped the addressable user at
open-source maintainers and hackathon projects. The question came from a founder during outreach:
"do you cater for private repos yet?"

**Decision: a GitHub App the user installs on repositories they pick. Not an OAuth App.**

- The OAuth `repo` scope is all-or-nothing read **and write** across every private repository the
  user can see. That is both an alarming consent screen for the exact audience we are courting, and
  a credential that turns a small breach into an incident. Rejected.
- With an App, **GitHub enforces the boundary** and the consent screen names the specific repos.
- We persist **only the installation id**, which is not a credential and grants nothing by itself.
  Access tokens are minted per request from the app private key, expire in about an hour, and are
  never written to the database or logged, so a database leak cannot be replayed against anyone's
  source.
- **Additive, not a login change.** Login stays Google-only and the manual handle input in Settings
  is untouched, so there is no second identity to reconcile and no disruption to the approved beta
  list. Switching login to GitHub was considered and deferred: it is the better end state for a
  developer product, but it breaks every whitelisted user today.

**Proof reads the README, file names and language stats. It never fetches file contents.** That is
what `fetchRepoSnapshot` does, and the claim shown to users in the connect UI depends on it staying
true. Note the consent screen says "Read access to **code** and metadata" because that is GitHub's
wording for `contents:read`; the permission permits more than we use, so the user-facing copy
describes what Proof does rather than what the token could do.

**Two failure modes fixed on the way, both of the same family: a swallowed error becoming plausible
garbage.**

- GitHub answers **404, not 403**, for private resources the caller cannot see, and
  `fetchRepoSnapshot` caught that as `"(no README found)"`. The pipeline would have scripted a video
  about an empty repo. The access check now sits on `repos.get`, the call that actually fails, so a
  repo that merely has no README still degrades quietly.
- A repo with no README now surfaces a warning instead of silently producing a thin script, because
  the user would otherwise blame the connection.

**Installs that begin on GitHub.** A user can install from `github.com/apps/<slug>` without ever
touching our button, in which case GitHub uses the app's setup URL and there is no signed state of
ours. Rejecting that stranded a real installation; blindly accepting it would let a crafted link
bind someone else's installation to whoever clicks it. Resolved by proving **ownership** instead:
the installation must belong to the GitHub handle already saved on that user's profile.
`decideInstallCallback` is pure so every branch is unit-tested.

**Consequences.** Requires `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY`, plus
migration `0017`. Without the env vars `githubAppConfigured()` is false, the connect UI never
renders, and behaviour is identical to before, so the feature can ship dark. The App must be set to
**"Any account"** or only its owner can install it; GitHub's API does not expose that flag, so it
can only be confirmed in the dashboard.

**Verified against real GitHub**, not mocks: app JWT to installation token to reading a genuinely
private repo (`LearnLoop`, 3663-char README, 159 paths), with the installation seeing only the one
granted repo out of 18, and `installationCanAccess` refusing an ungranted repo.

**References:** `src/lib/github-app.ts`, `src/lib/github.ts`, `src/app/api/github/*`,
`supabase/migrations/0017_github_app_install.sql`, `tests/github-private-repos.test.ts`,
`tests/github-install-callback.test.ts`, `tests/live-github-app.test.ts` (live, skipped in CI).
