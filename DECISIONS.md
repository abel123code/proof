# proof — Architectural Decision Records

**Append-only.** Never delete entries. If a decision is reversed, add a NEW entry referencing the old one.

Format: `## YYYY-MM-DD: Short title` → Context → Decision → Alternatives considered → Consequences → References.

For **what proof is** → [README.md](README.md)
For **the render service** → [render/README.md](render/README.md)
For **project rules** → [AGENTS.md](AGENTS.md) (imported by CLAUDE.md)

---

## 2026-07-10: Cap concurrent renders at 2 (env-tunable), don't run unbounded

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

**Consequences:** excess renders wait rather than crash; `queued` status is now meaningful (client already handles it). Server logs the cap at startup. **Caveat:** measured with 15s clips — longer clips hold more memory per job, so a 60s+ workload may need the cap dropped to 1. Retrying failed jobs is NOT implemented (an OOM'd or errored job stays `error`; client re-submits). Job state is still in-memory, so a redeploy mid-render still loses in-flight jobs (separate open issue).

**References:** `render/src/semaphore.ts`, `render/src/server.ts` (`renderGate`), `render/tests/semaphore.test.ts`, load test `render/tmp/loadtest.ts`; PR [#1](https://github.com/abel123code/proof/pull/1); related follow-up in memory `whisper-script-prompt` (transcription accuracy).

---

## 2026-07-15: Premium engine model tier + e2e finding — the model is NOT the pass-rate lever

**Context:** the bespoke-scene "premium" path (`render/src/premium/*`, `editMode: "generated-experimental"`) was mis-prompted and starved (default `gpt-4o`, no assets, ignored `brief.scenes`) — it reproduced the vending-machine text-card slop. PR [#8](https://github.com/abel123code/proof/pull/8) productionizes it: storyboard from `brief.scenes`, visual-first author/QA prompts, env-tunable model tier, parallel scene rendering.

**Model/effort decision (benchmarked).** Author writes the HTML (needs quality); QA + storyboard are judges (cheaper is fine). Per-model quirks centralized in `render/src/premium/model-params.ts`: gpt-5.x/o-series take `reasoning_effort` (low/med/high — **`minimal` is rejected**) and **reject a custom `temperature`**; gpt-4o is the reverse. We drop `temperature` entirely and only add `reasoning_effort` for models that accept it.

| Role | Default (env) | Effort | Price (per 1M in/out) |
|---|---|---|---|
| Author | `gpt-5.4` (`PREMIUM_AUTHOR_MODEL`) | low | $2.50 / $15 |
| QA + storyboard | `gpt-5.4-mini` (`PREMIUM_QA_MODEL`, `PREMIUM_PLAN_MODEL`) | low | $0.75 / $4.50 |

Latency (single author call, this account): gpt-5.5 medium 16.2s · gpt-5.5 low 9.2s (~40% faster, same model) · gpt-5.4-mini low 4.8s. `reasoning_effort=low` is the speed lever. Scenes render in parallel behind `createSemaphore(PREMIUM_CONCURRENCY, default 2)` — same proven ceiling as whole-job concurrency (3 heavy renders OOM); `MAX_QA_ITERS` default **2**.

**e2e finding (2026-07-15, real pipeline on the SUTD base, A/B on the author model):**

| Run | Author | QA retries | Scenes rendered | Wall-clock |
|---|---|---|---|---|
| A | gpt-5.4 @ low | 1 | **1 / 4** | 754s |
| B | gpt-5.5 @ low | 2 | **2 / 4** | 884s |

- ✅ **Plumbing works end-to-end** and **passing scenes rival the hand-made gold** (real Deadline Center screenshot in a browser frame, split-into-two-silos metaphor with brand-accent chips, face + caption band clear). QA is real (rejects generic-icon substitutes with specific feedback).
- ❌ **The model tier is NOT the lever.** gpt-5.5 + 2 retries moved pass rate 1/4 → 2/4 for ~2× the cost. Both models fail the SAME thing: embedding provided **logos into complex metaphors** (puppet-strings, split-silo headers) — they substitute generic icons. Simple asset layouts (CTA card, screenshot payoff) pass.

**Decision:** keep the **gpt-5.4 author default** (gpt-5.5 not worth 2× for +1 scene); keep `MAX_QA_ITERS=2` (the 2nd retry recovers scenes off QA feedback — measured). The real pass-rate levers are follow-ups, NOT a model upgrade:
1. **Deterministic asset-inclusion gate** — before rendering, assert the HTML `<img src>`s the asset the intent named; re-prompt specifically if missing. Cheaper + more reliable than a bigger model.
2. **Rasterize logos to PNG** (`sharp` is already a render dep) — the author handles PNG screenshots far better than SVG logos.
3. **Fix `scenesFromBrief` anchor-drop** — it silently dropped 2 of 6 brief scenes on overlap (nudge, don't drop).

**Alternatives considered:** default to gpt-5.5 author (rejected — marginal quality gain, 2× cost, doesn't fix the root cause); default to gpt-5.4-mini author (rejected — too weak); `MAX_QA_ITERS=1` for speed (rejected — measured 1/4 vs 2/4).

**Consequences:** premium stays behind the `editMode` gate + render-credit tier; nothing changes the default `brief-driven` path. Interaction caveat: parallel scene renders run inside one job slot — if `RENDER_CONCURRENCY > 1` combines with `PREMIUM_CONCURRENCY = 2`, worst case is `RENDER_CONCURRENCY × 2` heavy renders; drop `PREMIUM_CONCURRENCY` to 1 if premium jobs overlap.

**References:** PR [#8](https://github.com/abel123code/proof/pull/8); `render/src/premium/{model-params,scenes,author,qa,index}.ts`; plan `docs/superpowers/plans/2026-07-15-premium-engine-productionization.md`; full evidence + frames writeup in `docs/video-animation-roadmap.md` (Task 6 section).
