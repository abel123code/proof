# Proof for OpenAI Build Week

| | |
|---|---|
| Track | Work and productivity |
| Product | [tryproof.org](https://tryproof.org) |
| Repository | [abel123code/proof](https://github.com/abel123code/proof) |
| Demo video | TODO: add the public link |
| Codex `/feedback` session ID | TODO: add after the final feedback submission |

Proof turns a founder's GitHub work into a researched, scripted, recorded, and edited product
video. The founder chooses the angle and records the take. Proof handles the research, brief,
cut, captions, motion graphics, visual review, and final MP4.

## Submission scope

Proof existed before this event and placed 1st Runner-Up at 'Sup Build2026. Judge the work in
the Build Week commit window. The main additions are:

- GPT-authored HyperFrames scenes driven by each brief's spoken line, visual cue, brand motif,
  and uploaded assets.
- A fail-closed GPT-5.6 vision gate that reviews rendered frames and sends concrete repair
  reasons back to the scene author.
- GPT-5.6 role migration with Sol for judgment and Luna for high-volume mechanical work.
- Server-owned premium routing, so the normal user flow reaches the vision-reviewed pipeline.
- A deterministic speaker and caption safety mask before visual review.
- Asset inclusion checks, SVG rasterization, SSRF-hardened asset loading, and HTML
  sanitization.
- Durable render jobs, explicit ownership checks, credit refunds on failed starts, and bounded
  render/model concurrency.
- First-time onboarding and a no-signup landing demo on the default branch.

The commit history is the source of truth for dates and exact diffs.

## Where GPT-5.6 runs

| Stage | Role | Default |
|---|---|---|
| Repository understanding, proof extraction, brief drafting | Structured mechanical work | `gpt-5.6-luna` |
| Trend and reference research | Responses web search and extraction | `gpt-5.6-sol` |
| Angle generation and scoring | High-judgment ranking | `gpt-5.6-sol` |
| Brief-driven visual template selection | Small structured selection | `gpt-5.6-luna` |
| Premium scene plan fallback | Storyboard judgment when the brief has no usable scenes | `gpt-5.6-sol` |
| Premium scene author | HTML, layout, animation, and repairs | `gpt-5.6-sol` |
| Rendered-frame QA | Vision verdict and concrete issues | `gpt-5.6-sol` |

`whisper-1` remains responsible for word-level transcription. The cutter and scene anchors need
per-word timestamps. Proof also builds a vocabulary prompt from the script and keyword flags to
reduce proper-noun errors.

The role names follow OpenAI's [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6).
All model IDs remain environment-overridable.

## The vision QA loop

```text
brief + transcript
      |
      v
Sol authors HTML -> sanitize -> HyperFrames render -> speaker-safe alpha mask
      ^                                                    |
      |                                                    v
      +----------- concrete repair reasons <- Sol reviews five frames
```

The reviewer sees entrance, early, middle, late, and exit frames composited over the actual
speaker footage. Each image uses explicit `detail: "auto"`. On GPT-5.6, `auto` is equivalent
to original detail according to the [OpenAI image input guide](https://developers.openai.com/api/docs/guides/images-vision#choose-an-image-detail-level).

Approval requires explicit JSON with `ok: true` and an empty issues array. Empty output,
malformed JSON, named issues, unsafe HTML, missing required assets, and exhausted retries all
reject the scene. Rejected scenes stay out of the final composite. If no scene survives, the
captioned base video is returned.

The author prompt reserves a broad moving-speaker corridor. ffmpeg also clears authored alpha
inside that corridor and the caption band before QA. The model judges the masked result, so it
can still reject clipping, empty transitions, weak contrast, wrong text, or a meaningless
composition.

## Why this is an adaptive loop

Programmatic Tool Calling was evaluated and left out. Every vision verdict changes the next
author request. The repair prompt exists only after the rendered frames have been judged. The
current sequence is intentionally data-dependent:

```text
author -> render -> inspect -> decide -> repair or accept
```

Parallelism is used where decisions are independent. Separate scenes run through a semaphore
with a measured cap of two.

## Live verification on 2026-07-21

Small live requests confirmed these API shapes and returned the requested model IDs:

- Luna Chat Completions, JSON mode, `reasoning_effort: "none"`
- Sol Chat Completions for JSON planning and HTML authoring at low effort
- Sol image input with explicit `detail: "auto"`
- Sol Responses API with web search at low effort

The known SUTD fixture then ran through the complete production path with QA enabled:

- Source fixture: 8 seconds of real 1080x1920 talking-head footage
- Final cut: 7.53 seconds
- Wall time: 397 seconds on the local Windows verification machine
- Vision result: first scene rejected twice, then approved after the second repair
- Repair reasons: distinct deadline values, stronger entrance contrast, and exact headline copy
- Final validation: 1080x1920 MP4 with audio
- Composite check: final SHA-256 differed from the caption-only base
- Visual check: headline stayed above the speaker, deadline cards stayed below the face, and
  burned-in captions remained clear

The 397-second runtime is a real limitation. The model loop supplied useful feedback and passed
the corrected scene, but latency needs work before this can feel instant.

## Trust boundaries

Model-authored HTML is untrusted input. [`render/src/premium/sanitize.ts`](render/src/premium/sanitize.ts)
rejects external URLs, traversal, embedded documents, network APIs, dynamic imports, and code
evaluation before Chromium runs the scene.

Remote assets pass through [`render/src/premium/asset-source.ts`](render/src/premium/asset-source.ts):
HTTPS only, explicit host allowlist, private-address rejection after DNS resolution, no
redirects, image content types only, and a streaming byte cap.

The root render route authenticates the user, verifies brief ownership, reserves credits, and
creates a durable job before calling Railway. Failure to start refunds the credits. The render
service updates progress in `render_jobs` and uploads the completed MP4 to Supabase Storage.

## Built with Codex

Codex was used for the Build Week implementation and verification work:

- recovered the measured premium-engine branch and retained QA
- migrated model roles with tests before implementation
- traced the real browser request that forced `brief-driven` mode
- ran live Sol, Luna, web-search, vision, and full-render checks
- found the base-layer keyword chip that made author repairs impossible
- added regression tests for fail-closed QA, feedback handoff, mode ownership, request bounds,
  keyword-cue isolation, and the deterministic safety mask

Project guidance lives in `AGENTS.md`, `CLAUDE.md`, the dated ADRs, and the context notes under
`docs/`. Codex session evidence and the `/feedback` ID will be attached to the final submission.

## Reproduce

```bash
npm ci
cp .env.example .env.local
npm run verify              # 52 web tests
npm run build

npm --prefix render ci
npm --prefix render run check
npm --prefix render run test:unit   # 62 render tests
```

The repository's existing global lint run reports seven `react-hooks/set-state-in-effect`
errors in admin and studio effects. The Build Week branch leaves those effect bodies unchanged.

Run migrations through `0014_onboarding_tour.sql`, start the web app with `npm run dev`, and
start the render service with `npm --prefix render run server`. Full setup is in
[`README.md`](README.md) and [`render/README.md`](render/README.md).

## Remaining work

- Add the public demo video link.
- Submit Codex `/feedback` and add the session ID.
- Verify this branch on the production Railway and Vercel deployments after review.
- Reduce the six-minute local fixture latency.
- Replace the fixed speaker corridor with tracked subject masks for off-center footage.
- Run a production-hosted asset fixture through the full SVG-to-PNG and inclusion path.
