# Proof for OpenAI Build Week

Proof turns a founder's GitHub work into a researched, scripted, recorded, and edited product
video.

| | |
|---|---|
| Track | Work and productivity |
| Product | [tryproof.org](https://tryproof.org) |
| Backup deployment | [proof-build2026.vercel.app](https://proof-build2026.vercel.app) |
| No-signup demo | [Open the recording demo](https://proof-build2026.vercel.app/#demo) |
| GPT-5.6-rendered output | [Watch on YouTube](https://www.youtube.com/shorts/5Q1ufojJ_f4) |
| Repository | [abel123code/proof](https://github.com/abel123code/proof) |
| Eligibility base | [`adb92bc`](https://github.com/abel123code/proof/commit/adb92bcd9517fffaf875207d0da7be968ddc6c1e) |

## The problem

Technical founders can ship software faster than they can market it. A repository does not
explain itself to customers, and turning it into consistent video content requires research,
scripting, recording, editing, and visual review.

Proof reduces that work to one guided flow. The founder chooses the project and angle, records
the take, and keeps final control. Proof handles the research, brief, cutting, captions,
generated graphics, visual QA, and MP4 delivery.

This fits Work and productivity because it automates a real go-to-market workflow for founders
and small product teams.

## Eligibility boundary

Proof existed before Build Week and previously placed 1st Runner-Up at 'Sup Build2026. The event
permits existing projects when the submission separates the prior platform from work completed
during the submission period.

The eligibility base is commit
[`adb92bc`](https://github.com/abel123code/proof/commit/adb92bcd9517fffaf875207d0da7be968ddc6c1e),
committed on July 13 before the submission window opened.

### Before the submission window

The base already contained GitHub analysis, research, filming briefs, browser recording,
Whisper transcription, cutting, captions, fixed overlays, and an optional GPT-authored
HyperFrames path. Its initial visual QA parser failed closed and sent named issues back to the
author.

### Added or meaningfully extended during Build Week

| Area | Build Week work | Evidence |
|---|---|---|
| Durable render v2 | Brief-driven visuals, persistent jobs, render confirmation, credit handling | `4bb7be2`, `914f125` |
| Footage reliability | Multi-scene uploads, filename previews, browser fallback, playable MP4 storage | `5ac9339`, `2087bfa`, `331aa14` |
| Asset security | HTTPS allowlisting, DNS checks, local-file rejection, redirect blocking, streaming caps | `a67c702`, `d020997`, `d0930b5`, `eaf4878` |
| Product access | First-time onboarding and a no-signup landing demo | `9373a1b`, `c178d83` |
| Premium quality | Brief anchoring, visual-first prompts, asset inclusion checks, SVG rasterization, parallel scenes | `67a73ac` through `2fe16cf` |
| GPT-5.6 migration | Sol and Luna assigned by workload and verified against the live API | `39c270e` |
| Original-detail QA | Five composited frames sent with explicit `detail: "auto"` | `9abbdc5` |
| Normal user path | Web route and worker enforce the operator-selected render mode | `ec5c89f`, `21488b5` |
| Speaker safety | Alpha mask clears generated pixels over the speaker and captions | `bb255e1` |
| QA integrity | No runtime bypass, generic issues for unexplained rejection, repairable base layer | `21488b5` |
| Reproducibility | Root lockfile repaired and setup verified with clean installs | `639f7c3` |

Seven premium-engine commits were authored on July 15 and recovered onto this branch on July 21
with their original author timestamps. They remain separate commits instead of being squashed
into the migration.

```bash
git diff adb92bcd9517fffaf875207d0da7be968ddc6c1e..HEAD
git log --format=fuller adb92bcd9517fffaf875207d0da7be968ddc6c1e..HEAD
```

## Submission evidence

| Criterion | Evidence |
|---|---|
| Technological implementation | Adaptive render, inspect, and repair loop with 114 tests. Live GPT-5.6 checks and explicit trust boundaries. |
| Design | Complete GitHub-to-MP4 workflow, no-signup recording demo, and public generated output |
| Potential impact | Removes research, scripting, and video-editing work from founders without a content team |
| Quality of the idea | Generated graphics are reviewed as rendered pixels and can be rejected or repaired before delivery |

## Where GPT-5.6 runs

| Stage | Default | What it decides | Main code |
|---|---|---|---|
| Repository understanding and proof extraction | `gpt-5.6-luna` | Structured facts worth turning into content | `src/lib/openai.ts` |
| Brief drafting and mechanical JSON work | `gpt-5.6-luna` | Scene structure and content fields | `src/lib/openai.ts` |
| Trend and reference research | `gpt-5.6-sol` | Current sources and relevant patterns | `src/lib/openai.ts` |
| Angle generation and scoring | `gpt-5.6-sol` | Which story is worth filming | `src/lib/openai.ts` |
| Visual template selection | `gpt-5.6-luna` | Deterministic visual treatment | `render/src/visual-planner.ts` |
| Premium scene planning | `gpt-5.6-sol` | Scene timing and visual intent | `render/src/premium/scenes.ts` |
| Premium scene author | `gpt-5.6-sol` | HTML, layout, animation, and repairs | `render/src/premium/author.ts` |
| Rendered-frame QA | `gpt-5.6-sol` | Approval and concrete visual issues | `render/src/premium/qa.ts` |

`whisper-1` remains responsible for per-word transcription because cuts, captions, and scene
anchors need word timing. Invalid reasoning-effort values fail during configuration instead of
silently falling back.

## Why GPT-5.6 specifically

Proof's hardest model tasks are visual. The scene author writes a fresh HTML and animation
composition for each brief. GPT-5.6 improves frontend aesthetics, layout, hierarchy, and design
judgment, which directly affects that output.

The QA model reviews the generated scene over the real speaker footage. GPT-5.6 preserves
original image dimensions when detail is `auto` or `original`. Proof sends explicit
`detail: "auto"` so QA can inspect small overlaps, clipped text, weak contrast, and malformed
copy at the rendered resolution.

Sources:

- [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI image input detail guide](https://developers.openai.com/api/docs/guides/images-vision#choose-an-image-detail-level)

## The adaptive QA loop

```text
brief + transcript
       |
       v
Sol authors scene HTML
       |
       v
sanitize and verify assets
       |
       v
HyperFrames transparent render
       |
       v
speaker and caption alpha mask
       |
       v
composite over real footage
       |
       v
Sol reviews five rendered frames
       |
       +---- approved ----> final composite
       |
       +---- issues ------> author repair prompt
       |
       +---- exhausted ---> omit scene and preserve captioned base
```

The five samples cover the entrance, early state, midpoint, late state, and exit. Approval
requires:

```json
{
  "ok": true,
  "issues": []
}
```

Empty output, malformed JSON, named issues, unsafe HTML, missing assets, and exhausted retries
all reject the scene. `ok: false` without a reason receives a generic repair issue. The next
author request gets the previous HTML and the concrete QA issues.

Programmatic Tool Calling was evaluated and left out. Each review changes the next author
request, so the sequence is intentionally data-dependent. Independent scenes still run
concurrently behind a cap of two.

## Locally observed render verification

The API and fixture results below were observed on July 21 during the Codex task that produced
this branch. The test and build commands are reproducible. The public Short proves the final
artifact, while the internal retry log remains local.

Small live requests first confirmed:

- Luna Chat Completions with JSON mode and `reasoning_effort: "none"`
- Sol JSON planning and HTML authoring at low reasoning effort
- Sol Responses API web search
- Sol vision input with explicit `detail: "auto"`

An eight-second 1080x1920 SUTD talking-head fixture then ran through the production code path:

```text
Whisper transcription
    -> cutting
    -> Remotion captions
    -> Sol scene author
    -> HyperFrames render
    -> alpha mask
    -> five-frame Sol vision review
    -> repair prompts
    -> final ffmpeg composite
```

| Metric | Result |
|---|---|
| Source duration | 8 seconds |
| Final duration | About 7.65 seconds |
| Resolution | 1080x1920 |
| Wall time | 397 seconds |
| Initial scene | Rejected |
| First repair | Rejected |
| Second repair | Approved |
| Final visual check | Headline above speaker, cards below face, captions unobstructed |
| Public output | [Watch the rendered Short](https://www.youtube.com/shorts/5Q1ufojJ_f4) |

QA caught duplicate deadline values, weak entrance contrast, and malformed headline copy. The
second repair corrected the scene and passed the same five-frame review.

## Reproduce

```bash
npm ci
npm run verify
npm run build

npm --prefix render ci
npm --prefix render run check
npm --prefix render run test:unit
```

Expected results: 52 web tests, 62 render tests, and a successful Next.js production build. The
render suite covers fail-closed QA, issue handoff, exhausted retries, GPT-5.6 parameters,
original-detail payloads, mode ownership, fixed overlay removal, sanitizer bypasses, SSRF,
streaming limits, and a real ffmpeg ProRes alpha-pixel check.

## Trust boundaries

Model-authored HTML is untrusted. [`render/src/premium/sanitize.ts`](render/src/premium/sanitize.ts)
rejects external URLs, traversal, embedded documents, network APIs, dynamic imports, and code
evaluation before Chromium runs the scene.

Remote assets pass through
[`render/src/premium/asset-source.ts`](render/src/premium/asset-source.ts). They require HTTPS,
an allowed hostname, public DNS results, an image content type, and a bounded streamed size.
Redirects are disabled.

The Next.js render route authenticates the user, verifies brief ownership, reserves credits,
and creates a durable job before calling Railway. A failed worker start refunds the reservation.
Railway updates progress in `render_jobs` and uploads the completed MP4 to Supabase Storage.

Whole render jobs use a measured concurrency cap of two. Premium scene production has a separate
cap of two. OpenAI render calls have a 90-second deadline per attempt with one transient retry.

## How Codex contributed

| Phase | Codex work | Human decision |
|---|---|---|
| Context recovery | Read branch history, docs, render code, and prior experiments | Keep Proof and preserve its real history |
| Model migration | Located each model default, wrote role tests, and migrated Sol and Luna | Assign Sol to judgment and Luna to mechanical work |
| QA activation | Traced the browser request that bypassed the premium path | Make vision review mandatory |
| Visual debugging | Ran a real fixture and inspected rejected frames | Protect the speaker and captions deterministically |
| Repair debugging | Found fixed base graphics the scene author could not repair | Remove non-caption graphics from the premium base |
| API verification | Ran live Sol, Luna, web-search, and image-input checks | Keep only integrations that passed |
| Reliability | Added request bounds, worker mode enforcement, and bypass tests | Fail safely to the captioned base |
| Review | Used independent code and deliverable audits | Publish measured claims only |

The required `/feedback` Session ID comes from the primary Codex task that produced this branch
and is supplied through the Devpost submission.

## Known limits

- A premium render with two repairs took 397 seconds locally.
- The fixed alpha mask assumes a broadly centered talking head.
- A scene that never passes QA is omitted.
- If every premium scene fails, Proof returns the captioned base video.
- The no-signup experience covers recording. Full GitHub analysis and rendering require an
  approved account and configured services.
