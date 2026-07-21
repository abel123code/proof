# Proof roadmap

Last updated: 2026-07-21.

## Shipped foundation

Proof already runs one product path from repository analysis to a final vertical MP4:

- GPT-5.6 Luna extracts repository proof and drafts structured briefs
- GPT-5.6 Sol researches current demand, ranks angles, authors scenes, and reviews rendered frames
- Whisper word timestamps drive cutting, captions, and scene anchors
- HyperFrames creates bespoke transparent motion graphics
- FFmpeg composes the real footage, captions, safety mask, and approved scenes
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

Detect the subject and crop per clip, normalise framing before scene authoring, and derive the
protected speaker region from the actual footage. Use that geometry when planning every layout.

### 4. Agent-authored scene systems

Move beyond caption-shaped overlays toward diagrams, product walkthroughs, UI reconstructions,
timelines, comparisons, and recurring visual callbacks. Give the creative director a shot library
and continuity state across the whole video.

### 5. Resumable, observable rendering

Checkpoint completed scenes, resume after transient failures, record author and QA latency, and
surface the correction history in the product. Re-measure concurrency with full-length clips
before widening access.

## Product principle

The model may propose a scene. Proof ships only rendered pixels that pass deterministic safety
checks and visual review.
