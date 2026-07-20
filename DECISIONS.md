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
