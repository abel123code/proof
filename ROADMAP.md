# proof — Roadmap / Current State

**Where are we now** (the doc `/compacting-ready` audits). For **why** decisions were made → [DECISIONS.md](DECISIONS.md). For **what proof is** → [README.md](README.md).

_Last updated: 2026-07-10._

## One-liner
Point proof at your GitHub repo. It studies what's working in your niche, writes a film-ready script, you read it off a teleprompter, and it edits the finished video. Built at 'Sup hackathon #6 (Build2026) by Abhishek Vulla + Abel Lee, placed 2nd.

## Status: prepping for the SUTD hackathon demo
Plan: give students free access (10k+ OpenAI credits), 1000 credits/new user, waitlist for the first 50.

## Render service (`render/`) — DEPLOYED & WORKING
- Live on Railway: `https://proof-render-production.up.railway.app` (migrated off Zo).
- Pipeline: recording → whisper-1 word-level transcribe → cut fillers/dead-space → ffmpeg concat → Remotion transparent overlay → ffmpeg composite → Supabase upload. `render/README.md` is authoritative.
- Concurrency capped at 2 (measured; `RENDER_CONCURRENCY` env var) — see DECISIONS.md 2026-07-10.
- Optional `RENDER_TOKEN` shared-secret auth on `/render`.
- Decision locked: staying on **Remotion**, not switching to HyperFrames (they render the same frames; the quality lever is design + a QA loop, not the engine).

## In flight
- **PR [#1](https://github.com/abel123code/proof/pull/1)** (Abhishek): Railway deploy + cue-anchor/caption bug fixes + render concurrency gate. Awaiting Abel's review/merge.
- **Abel:** auth, 1000-credit system, waitlist for first 50 (product/frontend; doesn't touch the render service).

## Next / TODO
- [ ] Merge PR #1.
- [ ] Set `RENDER_SERVICE_URL` + `RENDER_TOKEN` in the Next app's Vercel env (or renders 401 / hit localhost).
- [ ] Update GitHub repo homepage to the live URL (needs repo admin — Abel).
- [ ] (Before scale) transcription accuracy: pass `brief.script` as the whisper prompt, or swap to a better word-timestamp transcriber (Groq whisper-large-v3 / ElevenLabs Scribe). See memory `whisper-script-prompt`.
- [ ] (Backlog) port a frame-extraction visual-QA loop into the Remotion pipeline (kills the manual eyeball-and-re-render grind).
- [ ] (Backlog) `cut.ts` 650ms word-cap can clip a long word before a cut (latent; doesn't bite current content).
- [ ] (Backlog) persist job state so a Railway redeploy doesn't lose in-flight renders.

## Known limitations (accepted for now)
- Render job state is in-memory: a redeploy/restart mid-render loses that job (client re-submits).
- `render/tmp` + `out` are ephemeral; DB-backed jobs persist finals to Supabase Storage.
- Demo video experiment (`render/tmp/`, gitignored) proved the HyperFrames-vs-Remotion question — kept out of the repo.
