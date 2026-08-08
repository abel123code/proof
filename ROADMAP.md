# Proof roadmap

Last updated: 2026-08-08.

## Shipped foundation

Proof already runs one product path from repository analysis to a final vertical MP4:

- GPT-5.6 Luna extracts repository proof and drafts structured briefs
- GPT-5.6 Sol researches current demand, ranks angles, authors scenes, and reviews rendered frames
- Whisper word timestamps drive cutting, captions, and scene anchors
- HyperFrames creates transparent creator-native scenes; FFmpeg places full-frame explanations over footage or hard-cuts them to black
- FFmpeg composes footage, creator visuals, then captions last; every scene carries an auditable QA verdict
- Supabase stores durable jobs, credits, progress, and final videos
- Railway runs the resource-heavy rendering service

The current verification baseline is recorded in `README.md` and `OPENAI_BUILD_WEEK.md`.

## Measured render performance (2026-08-08)

Same brief, clips and assets throughout; stage split from the worker's timestamped logs via
`render/scripts/bench-render.ts`:

| | before | after |
|---|---|---|
| total | 593.1s | **465.8s** |
| scene authoring + QA | 386.8s | 308.8s |
| caption overlay render | 65.8s | 67.2s |
| wasted authoring attempts | 2 | **0** |

Scene authoring is ~two thirds of a render and is already parallel (`PREMIUM_CONCURRENCY`, default
2). Raising it is **unmeasured**: the 2026-07-10 load test found that one render already saturates
the CPU and that 3 concurrent whole-renders OOM the composite, so more workers may split the same
cores rather than add throughput. Measure before assuming.

The caption overlay is rendered before premium starts, but `runPremium` only needs it for its final
composite. Overlapping the two is worth roughly 66s of a ~470s render - real, but the smaller lever.

## Known gaps (carry these into any launch decision)

1. **Frame-edge overflow has no deterministic check.** The vision QA notices it sometimes; nothing
   enforces it. This is the most likely visible defect in a user's video.
2. **One retry budget is shared by every gate.** Deterministic gates run before the render and the
   vision QA after it, so a misfiring gate can consume every attempt and starve the visual review -
   the failure that shipped a clipped screenshot on job `f68a8dab`. Separate budgets are the fix.
3. **A full desktop page in 9:16 leaves interface text small.** Showing fewer rows larger -
   selection rather than reproduction - is the real answer and is not built.
4. **No brand-colour control in the UI.** `/api/assets` accepts `brandColor` but nothing sends one,
   so a stale value can only be changed by editing the database directly.

## Next quality bar

### 1. Brand-aware scene direction (partly shipped)

Shipped: a brief carries its own screenshots and logos, each read once at upload into a caption plus
the verbatim on-screen text. Scenes rebuild a product interface as HTML from those strings rather
than cropping the bitmap, and a deterministic gate rejects any text inside a reconstruction that the
screenshot did not contain.

Next: derive palette and typography from the assets rather than letting the planner invent an accent
per render, and add the missing brand-colour control.

### 2. A stronger visual correction loop

Turn QA findings into explicit composition changes, compare repaired frames against the rejected
candidate, and measure whether the issue was actually fixed. Track acceptance rate, repair count,
fallback rate, and the defects that recur across projects.

### 3. Shot-aware composition

Detect the subject and crop per clip, and normalise framing before scene authoring. Feed the
detected speaker position to the author and replace the current fixed overlay-only safety mask with
shot-aware geometry. Full-frame scenes intentionally do not use a speaker mask.

### 4. Agent-authored scene systems (creator-native foundation shipped)

The global editor now selects clean A-roll, one-object overlays, and full-frame explanatory beats,
then shares palette, typography, spacing, motif, and transition grammar across every scene. Next:
add a real shot library, stronger product-proof capture, and continuity-aware scene transitions.

### 5. Resumable, observable rendering

Checkpoint completed scenes, resume after transient failures, record author and QA latency, and
surface the correction history in the product. Re-measure concurrency with full-length clips
before widening access.

## Product principle

The model may propose a scene, but it never self-approves. Deterministic safety checks and an
editorial vision review judge every rendered scene; QA is an auditable advisor, so a scene may ship
*flagged* - its unresolved issues surfaced to the user - rather than being silently dropped. The
human decides what to re-render.
