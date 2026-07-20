# Proof roadmap and current state

Last updated: 2026-07-21.

Proof turns a founder's GitHub work into a researched, scripted, recorded, and edited vertical
video. The product previously placed 1st Runner-Up at 'Sup Build2026 and is now being prepared
for OpenAI Build Week.

## Current state

- Next.js app with GitHub analysis, web-search research, angle scoring, briefs, teleprompter,
  GitHub OAuth, onboarding, credits, and render confirmation.
- Railway render service with durable Supabase jobs and a measured concurrency cap of two.
- `whisper-1` word timestamps with a script and keyword-derived vocabulary prompt.
- Remotion captions and ffmpeg cutting/composition.
- GPT-5.6 Sol premium scene authoring through HyperFrames.
- Five-frame, original-detail Sol vision QA with concrete author repairs and fail-closed parsing.
- Deterministic speaker and caption alpha mask before QA.
- Sanitized model HTML and SSRF-hardened remote asset loading.
- Server-owned premium mode on the normal user path.

## Verified on 2026-07-21

- 52 web tests passed.
- 59 render tests passed.
- Live Sol and Luna Chat Completions passed.
- Live Sol Responses web search passed.
- Live Sol vision input with `detail: "auto"` passed.
- An eight-second SUTD fixture completed the full premium path in 397 seconds.
- Vision QA rejected two variants and approved the second repair.
- The final 1080x1920 MP4 differed from the caption-only fallback.

## Before submission

- [ ] Add the public demo video link to `README.md` and `OPENAI_BUILD_WEEK.md`.
- [ ] Submit Codex `/feedback` and add the Session ID.
- [ ] Verify the branch on the production Vercel and Railway deployments after review.
- [ ] Confirm production model access and environment overrides use the GPT-5.6 defaults.
- [ ] Record a judge path that finishes under three minutes.

## Product and quality follow-ups

- [ ] Reduce premium latency. The local eight-second fixture took 397 seconds with two repairs.
- [ ] Track the subject and derive a per-video safety mask for off-center footage.
- [ ] Run a hosted asset fixture through fetch, SVG rasterization, inclusion checking, QA, and
      final composition.
- [ ] Add observability for author latency, QA verdicts, repair count, fallback rate, and scene
      acceptance rate.
- [ ] Add resumable scene production so a transient model failure only reruns the affected scene.
- [ ] Revisit the render concurrency cap with 60-second clips before wider access.

## Accepted limitations

- Premium rendering is measured in minutes.
- The current safety mask assumes a broadly centered talking head.
- A premium failure returns the captioned base video.
- Local and legacy `/out` files remain ephemeral. DB-backed jobs and final videos are durable in
  Supabase.
