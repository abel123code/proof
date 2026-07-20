# Proof roadmap

Last updated: 2026-07-21.

## Current state

Proof runs from GitHub analysis through research, filming, and final vertical MP4 delivery.
The normal render path uses GPT-5.6 Sol for scene authoring and five-frame vision QA, with Luna
handling structured high-volume work.

The current release includes:

- durable Supabase render jobs and final-video storage
- script-informed `whisper-1` word timestamps
- ffmpeg cutting and Remotion captions
- HyperFrames scene authoring with asset inclusion checks
- fail-closed, original-detail GPT-5.6 vision QA
- concrete author repairs after rejection
- deterministic speaker and caption alpha masking
- sanitized model HTML and SSRF-hardened assets
- operator-owned render mode at both web and worker boundaries

## Verified baseline

- 52 web tests
- 62 render tests
- production Next.js build
- live Sol and Luna Chat Completions
- live Sol Responses web search
- live Sol image input with `detail: "auto"`
- full eight-second fixture through authoring, masking, two repairs, and final composition

## Product priorities

1. Reduce premium latency. The measured eight-second fixture took 397 seconds with two repairs.
2. Track the subject and derive the protected region per video instead of assuming a centered
   talking head.
3. Add hosted asset fixtures covering fetch, SVG rasterization, inclusion checks, QA, and final
   composition.
4. Record author latency, QA verdicts, repair count, fallback rate, and scene acceptance rate.
5. Resume scene production after transient failures instead of rerunning the full job.
6. Re-measure worker concurrency with 60-second clips before widening access.

## Accepted limits

- Premium rendering currently takes minutes.
- The safety mask assumes a broadly centered talking head.
- A rejected generated scene is omitted.
- If no generated scene passes QA, Proof returns the captioned base video.
- Local and legacy `/out` files are ephemeral. Database-backed jobs and final videos are durable.
