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
