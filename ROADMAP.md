# proof — Roadmap / Current State

**Where are we now** (the doc `/compacting-ready` audits). For **why** decisions were made → [DECISIONS.md](DECISIONS.md). For **what proof is** → [README.md](README.md).

_Last updated: 2026-07-17._

## One-liner
Point proof at your GitHub repo. It studies what's working in your niche, writes a film-ready script, you read it off a teleprompter, and it edits the finished video. Built at 'Sup hackathon #6 (Build2026) by Abhishek Vulla + Abel Lee — **1st Runner-Up (2nd place), 300+ builders**.

## Status: LIVE in invite-only beta
- Product: **https://www.tryproof.org/** (SUTD-WiFi fallback: `proof-build2026.vercel.app`).
- Invite-only, capped at **50 founding users**; each new user gets **1000 credits (~5 videos)**.
- Onboarding guide + in-app bug reporting shipped so beta feedback comes back with render context attached.

## Render service (`render/`) — DEPLOYED & WORKING
- Live on Railway: `https://proof-render-production.up.railway.app` (**migrated off Zo**, 9–10 Jul).
- Pipeline: recording → whisper-1 word-level transcribe → cut fillers/dead-space → ffmpeg concat → Remotion transparent overlay → ffmpeg composite → Supabase upload. `render/README.md` is authoritative.
- Concurrency capped at 2 (**measured**; `RENDER_CONCURRENCY` env var) — see DECISIONS.md 2026-07-10.
- Optional `RENDER_TOKEN` shared-secret auth on `/render`.
- **render v2** (2026-07-14): brief-driven durable render pipeline.
- Decision locked: staying on **Remotion**, not switching to HyperFrames — see DECISIONS.md 2026-07-14.

## Premium bespoke-scene engine
LLM storyboards each scene → renders it programmatically → a **vision model QAs the rendered frames**, plus script-as-prompt whisper. Shipped in PR #5; productionisation in flight (#8 / #9).
- **E2E finding: the model is NOT the pass-rate lever** — design + the QA loop is.
- Next levers: asset-inclusion gate, PNG logos, anchor-drop fix.

## In flight (open PRs)
- **[#8](https://github.com/abel123code/proof/pull/8)** — productionize the bespoke-scene engine (brief.scenes + visual-first prompts + fast parallel tier).
- **[#9](https://github.com/abel123code/proof/pull/9)** — per-brief brand-assets folder (screenshots + logo + brand colour).
- **[#10](https://github.com/abel123code/proof/pull/10)** — in-app bug reports with auto-attached render context. *(current branch: `feat/bug-reports`)*
- **[#4](https://github.com/abel123code/proof/pull/4)** (Abel) — Playwright E2E testing.

## Shipped in July (merged)
| PR | What |
|---|---|
| #1 | Railway deploy for the render service + caption/cue fixes + concurrency gate |
| #2 | Direct-to-Supabase signed upload (fixes the >30s cap) + closed footage/render IDOR |
| #3 | Branding: play-P favicon + OpenGraph/Twitter cards + humanized metadata |
| #5 | Premium bespoke-scene pipeline + vocabulary-prompt whisper |
| #6 | Closed SSRF + local-file-read in premium asset fetching |
| #7 | Filename + inline preview for uploaded scene footage |

Also shipped: unified credit wallet + live balance, **RLS on all remaining public tables**, project-ownership enforcement on project-scoped routes, mobile studio (375–414px), resume-in-progress projects, teleprompter Safari/iOS hardening, first-time onboarding guide.

## Next / TODO
- [ ] Merge the open PRs (#8, #9, #10).
- [ ] (Before scale) transcription accuracy: pass `brief.script` as the whisper prompt, or swap to a better word-timestamp transcriber (Groq whisper-large-v3 / ElevenLabs Scribe). See memory `whisper-script-prompt`.
- [ ] Verify `RENDER_SERVICE_URL` + `RENDER_TOKEN` are set in the Next app's Vercel env (or renders 401 / hit localhost).
- [ ] (Backlog) port the frame-extraction visual-QA loop into the **main** Remotion pipeline — the premium engine has it, the standard path still needs manual eyeballing.
- [ ] (Backlog) `cut.ts` 650ms word-cap can clip a long word before a cut (latent; doesn't bite current content).
- [ ] (Backlog) persist job state so a Railway redeploy doesn't lose in-flight renders.

## Done (previously TODO)
- [x] Merge PR #1 — merged 2026-07-10.
- [x] Update the GitHub repo homepage to the live URL — now `https://www.tryproof.org/`.

## Known limitations (accepted for now)
- Render job state is in-memory: a redeploy/restart mid-render loses that job (client re-submits).
- `render/tmp` + `out` are ephemeral; DB-backed jobs persist finals to Supabase Storage.
- Demo video experiment (`render/tmp/`, gitignored) proved the HyperFrames-vs-Remotion question — kept out of the repo.
