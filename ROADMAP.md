# Proof roadmap

Last updated: 2026-07-23.

## Shipped foundation

Proof already runs one product path from repository analysis to a final vertical MP4:

- GPT-5.6 Luna extracts repository proof and drafts structured briefs
- GPT-5.6 Sol researches current demand, ranks angles, authors scenes, and reviews rendered frames
- Whisper word timestamps drive cutting, captions, and scene anchors
- HyperFrames creates bespoke transparent motion graphics
- FFmpeg composes the real footage, captions, and bespoke scenes, each carrying an auditable QA verdict
- Supabase stores durable jobs, credits, progress, and final videos
- Railway runs the resource-heavy rendering service

The current verification baseline is recorded in `README.md` and `OPENAI_BUILD_WEEK.md`.

## Next quality bar

### 1. Brand-aware scene direction

Let a founder attach a repository or assets folder, then extract its visual language: real
screenshots, logos, typography, colour, spacing, interface patterns, and recurring motifs. Carry
that design system into every authored scene instead of asking the model to invent one from text.

### 2. A stronger visual correction loop

Turn QA findings into explicit composition changes, compare repaired frames against the rejected
candidate, and measure whether the issue was actually fixed. Track acceptance rate, repair count,
fallback rate, and the defects that recur across projects.

### 3. Shot-aware composition

Detect the subject and crop per clip, and normalise framing before scene authoring. Feed the
detected speaker position to the author as *guidance* for where a face is likely to sit — not as a
hard geometry mask, which was tried and rejected (see DECISIONS.md 2026-07-23).

### 4. Agent-authored scene systems

Move beyond caption-shaped overlays toward diagrams, product walkthroughs, UI reconstructions,
timelines, comparisons, and recurring visual callbacks. Give the creative director a shot library
and continuity state across the whole video.

### 5. Resumable, observable rendering

Checkpoint completed scenes, resume after transient failures, record author and QA latency, and
surface the correction history in the product. Re-measure concurrency with full-length clips
before widening access.

## Product principle

The model may propose a scene, but it never self-approves. Deterministic safety checks and an
editorial vision review judge every rendered scene; QA is an auditable advisor, so a scene may ship
*flagged* — its unresolved issues surfaced to the user — rather than being silently dropped. The
human decides what to re-render.
