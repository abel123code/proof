# Proof roadmap

Last updated: 2026-07-24.

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
