# Proof for OpenAI Build Week

**Track: Work and productivity**

Proof turns a founder's GitHub work into a researched, scripted, recorded, and edited product
video.

| | |
|---|---|
| Product | [tryproof.org](https://tryproof.org) |
| No-signup recording demo | [Open demo](https://proof-build2026.vercel.app/#demo) |
| Narrated Build Week demo | [Watch on YouTube](https://youtu.be/2bPF0pfeWAo) |
| Output edited by Proof | [Watch the Short](https://www.youtube.com/shorts/5Q1ufojJ_f4) |
| Repository | [abel123code/proof](https://github.com/abel123code/proof) |
| Built with | OpenAI Codex |
| Runtime intelligence | GPT-5.6 Sol, GPT-5.6 Luna, Responses web search, Whisper |

## The problem

Technical founders have more software than distribution.

The work worth talking about already exists in the repository, but customers do not read commit
history. Turning it into a good product video means finding the angle, writing the script,
recording it, cutting dead space, building visuals, and reviewing the final frames. Founders
either become video editors or stop after the launch tweet.

Proof turns that work into one guided flow. The founder picks the project and angle, records the
take, and keeps the final say. OpenAI handles the research, structured brief, creative direction,
scene authoring, and rendered-frame review.

## OpenAI is the editor inside Proof

Proof uses each OpenAI model for the kind of work it is good at.

### GPT-5.6 Luna handles structured volume

Luna reads repository data, extracts the facts worth showing, finds information GitHub cannot
provide, and drafts the scene-by-scene brief. These calls need reliable JSON and low latency.
They run with <code>reasoning_effort: "none"</code>.

Main code:

- [<code>src/app/api/analyze-repo/route.ts</code>](src/app/api/analyze-repo/route.ts)
- [<code>src/lib/research.ts</code>](src/lib/research.ts)
- [<code>src/lib/content-brief.ts</code>](src/lib/content-brief.ts)
- [<code>src/lib/openai.ts</code>](src/lib/openai.ts)

### GPT-5.6 Sol makes the judgment calls

Sol runs where one bad decision weakens everything downstream:

- Responses API web search for current conversations and real reference URLs
- angle generation and ranking against hook, relevance, shareability, and saveability
- fallback storyboard planning when the approved brief has no usable scene directions
- bespoke HyperFrames HTML, layout, asset use, and animation
- five-frame vision review of the scene over the real speaker footage
- concrete defect reports for the next authoring attempt

Main code:

- [<code>src/lib/openai.ts</code>](src/lib/openai.ts)
- [<code>src/lib/research.ts</code>](src/lib/research.ts)
- [<code>render/src/premium/scenes.ts</code>](render/src/premium/scenes.ts)
- [<code>render/src/premium/author.ts</code>](render/src/premium/author.ts)
- [<code>render/src/premium/qa.ts</code>](render/src/premium/qa.ts)

### Whisper gives the editor a real timeline

Proof uses <code>whisper-1</code> because the cutter needs per-word timestamps. Product names,
acronyms, and keyword flags are extracted from the brief into a capped vocabulary hint. Those
timestamps drive dead-space removal, captions, emphasis, and scene anchors. The timeline is
remapped after every cut.

Main code:

- [<code>render/src/transcribe.ts</code>](render/src/transcribe.ts)
- [<code>render/src/cut.ts</code>](render/src/cut.ts)
- [<code>render/src/remap.ts</code>](render/src/remap.ts)

## Model and reasoning policy

| Stage | Model | API | Reasoning |
|---|---|---|---|
| Repository understanding | <code>gpt-5.6-luna</code> | Chat Completions, JSON mode | <code>none</code> |
| Proof extraction and brief drafting | <code>gpt-5.6-luna</code> | Chat Completions, JSON mode | <code>none</code> |
| Trend and reference research | <code>gpt-5.6-sol</code> | Responses API + <code>web_search</code> | <code>low</code> |
| Angle generation and scoring | <code>gpt-5.6-sol</code> | Chat Completions, JSON mode | model default |
| Fallback scene planning | <code>gpt-5.6-sol</code> | Chat Completions, JSON mode | <code>low</code> |
| HyperFrames scene authoring | <code>gpt-5.6-sol</code> | Chat Completions | <code>low</code> |
| Rendered-frame QA | <code>gpt-5.6-sol</code> | Chat Completions + five PNGs | <code>low</code> |
| Word timing | <code>whisper-1</code> | Audio transcription | per-word timestamps |

Premium effort can be set independently for planning, authoring, and QA. Supported values run
from <code>none</code> through <code>max</code>. Invalid configuration throws instead of silently
falling back. GPT-5.x calls never receive a legacy temperature parameter. Every premium request
has a 90-second deadline and one transient retry.

This is workload routing, not model name swapping. Luna keeps structured stages cheap. Sol gets
the tasks where judgment changes the final artifact.

Sol proposes the angle rubric dimensions, but Proof clamps each value to 0–100 and recomputes the
weighted total in TypeScript. The model supplies judgment. Production code owns the final rank.

## Why GPT-5.6 fits this workload

OpenAI's GPT-5.6 guidance calls out stronger frontend layout, hierarchy, and design judgment.
Proof's scene author writes an interface-like composition for every important beat, so those
capabilities map directly to the work.

GPT-5.6 also preserves original image dimensions when image detail is <code>auto</code> or
<code>original</code>. Proof sends explicit <code>detail: "auto"</code> for every QA frame. Small
face overlaps, clipped copy, and weak contrast stay visible to the reviewer.

Sources:

- [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI image and vision guidance](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI code generation and Codex](https://developers.openai.com/api/docs/guides/code-generation#use-codex)

## The render, inspect, repair loop

~~~text
approved brief + word timeline
        |
        v
scene intent + brief context
        |
        v
GPT-5.6 Sol authors HyperFrames HTML
        |
        v
sanitize HTML and verify required assets
        |
        v
HyperFrames renders a transparent ProRes scene
        |
        v
deterministic speaker and caption alpha mask
        |
        v
FFmpeg composites scene over the real footage
        |
        v
Sol reviews five original-detail PNGs
        |
        +---- approved ----> final composite
        |
        +---- named issues -> author another candidate
        |
        +---- exhausted ---> omit scene, preserve captioned base
~~~

Approval requires:

~~~json
{
  "ok": true,
  "issues": []
}
~~~

Empty responses, malformed JSON, unsafe HTML, named issues, and exhausted retries reject the
scene. Missing assets trigger targeted re-authoring and remain subject to visual QA. There is no
runtime switch that bypasses vision review on the normal render path.

## Engineering beyond the model call

### The renderer owns pixels, the model owns decisions

Source footage stays with FFmpeg. Remotion renders captions. HyperFrames renders transparent
motion graphics. GPT-5.6 plans, authors, and reviews. Separating those responsibilities avoids
source-video seek failures and makes every generated layer inspectable before delivery.

### Generated code crosses a trust boundary

The model-authored page runs in Chromium, so Proof treats it as untrusted input. Before render,
the sanitizer rejects external references, traversal, embedded documents, known browser network
APIs, dynamic imports, evaluation APIs, and unknown assets. Remote images pass an HTTPS allowlist,
public-DNS check, content-type check, redirect ban, and streamed byte limit.

### Visual safety has a deterministic floor

The scene prompt reserves space around the speaker, but the renderer also clears authored alpha
inside the moving-speaker corridor and caption band. Prompt compliance is useful. Deterministic
masking is enforceable. Sol then judges the remaining composition for design, spelling, clipping,
contrast, duplicated captions, and empty visuals.

### Render jobs survive the web request

The Next.js route authenticates the user, checks brief ownership, reserves credits, creates a
durable job, and then calls Railway. A failed worker start refunds the reservation. Railway
stores progress in Postgres, reclaims stale work after restarts, uploads the final MP4, and marks
the job complete.

### Concurrency was load-tested

A Railway load test used concurrent 15-second renders. One completed in 34.4 seconds. Two both
completed at 27.6 seconds per job because network waits overlapped. At three, FFmpeg exhausted the
worker's available memory. The production cap is two, with separate limits for whole jobs and
premium scenes.

## Built with Codex

Codex was the primary engineering environment for Proof.

The workflow used:

- isolated Git worktrees to protect the active checkout
- Codex CLI and shell tools for repository archaeology, implementation, tests, FFmpeg checks, and
  deployment diagnostics
- the OpenAI Docs MCP to verify GPT-5.6 model IDs, reasoning parameters, image detail, and API
  behavior against current first-party documentation
- GitHub CLI to inspect history, pull requests, and the exact public submission state
- parallel read-only Codex agents for independent judge, claims, and repo-hygiene audits
- Playwright browser inspection at desktop and mobile widths for the public landing page
- live Sol, Luna, Responses web-search, and vision requests before documenting the integration
- rendered-frame inspection as the acceptance check for generated visuals

Codex recovered work across branches, migrated the model roles, traced the request path that
bypassed premium rendering, closed QA bypasses at both service boundaries, added the alpha mask,
expanded the tests, and verified the real render loop.

The human decisions were product and system calls: focus on founders, keep Proof as one complete
workflow, assign Sol and Luna by workload, keep vision QA mandatory, protect the speaker
deterministically, treat model HTML as hostile, and leave Programmatic Tool Calling out of a
data-dependent repair loop.

## Verification

| Evidence | Result |
|---|---|
| Web application tests | 54 passed |
| Render-service tests | 62 passed |
| Total automated tests | 116 passed |
| Web and render TypeScript checks | Passed |
| Production Next.js build | Passed |
| Live Luna JSON request | Passed |
| Live Sol planning and authoring | Passed |
| Live Responses web search | Passed |
| Live Sol vision with original-detail images | Passed |
| Real FFmpeg ProRes alpha-pixel check | Passed |
| Eight-second production fixture | Two variants rejected, second repair approved |
| Final fixture | 1080x1920 MP4 with audio |

Reproduce the local checks:

~~~bash
npm ci
npm run verify
npm run build

npm --prefix render ci
npm --prefix render run check
npm --prefix render run test:unit
~~~

The public no-signup demo lets judges test the recording flow without creating an account.
Full setup and the repository map are in [<code>README.md</code>](README.md). The standalone
render contract is in [<code>render/README.md</code>](render/README.md).

## Judging map

| Build Week criterion | Evidence in Proof |
|---|---|
| Technological implementation | Deliberate Sol/Luna routing, Responses web search, word-level Whisper cuts, model-authored HyperFrames, original-detail visual QA, fail-closed parsing, deterministic masks, durable jobs, SSRF controls, and 116 tests |
| Design | Complete GitHub-to-MP4 product, browser teleprompter, no-signup recording demo, generated visuals, and final delivery |
| Potential impact | Removes research, scripting, editing, and visual-review work from founders without a content team |
| Quality of the idea | A video editor where the model reviews rendered pixels and can repair or reject its own scene before delivery |

<details>
<summary><strong>Build Week commit evidence</strong></summary>

Proof is an existing product that was substantially extended during the submission period. The
public baseline is commit
[<code>adb92bc</code>](https://github.com/abel123code/proof/commit/adb92bcd9517fffaf875207d0da7be968ddc6c1e),
created before the July 13 submission window.

The dated commit trail after that boundary contains the durable render system, multi-scene
footage fixes, asset security, onboarding, bespoke-scene engine, GPT-5.6 migration,
original-detail QA, operator-owned render mode, speaker mask, and reproducible setup.

~~~bash
git diff adb92bcd9517fffaf875207d0da7be968ddc6c1e..HEAD
git log --format=fuller adb92bcd9517fffaf875207d0da7be968ddc6c1e..HEAD
~~~

The required <code>/feedback</code> Session ID is supplied through the Devpost submission form.

</details>
