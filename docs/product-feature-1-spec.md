# Reverse-Engineer — Product Spec (Build2026, 12h)

## One-liner
You shipped a project. Reverse-Engineer turns it into recruiter-facing UGC content by reverse-engineering what already works in your niche — so introverted devs get *seen* without becoming content creators.

## The problem (honest version)
The job market is saturated. Recruiters spend ~11 seconds on a GitHub profile. The advice everyone gets is "do your personal branding, don't be like everyone else" — post on TikTok, write blogs that rank, market your projects. But the people who most need this (technical job seekers) won't do it: it's not "CS stuff," it feels foreign, and the activation energy is too high. They build something decent and ship it into a void.

## The user (sharpened, not "all job seekers")
A job-seeking / portfolio-building developer who has **already built something they believe in** and wants traction on it — but won't film TikToks, write ranking blog posts, or do the marketing grind themselves. Indie hackers, CS students, devs who ship regularly. Launches are recurring for this user, which is the retention answer.

## Core thesis
- Differentiation is NOT "AI writes content" (saturated). It's: **reverse-engineer proven, high-performing content structure and re-skin it to the user's project**, framed for credibility, distributed dev-native.
- The moat is the **brief/analysis intelligence**, not the renderer or the editor UI. Remotion is commodity. The judgment of *which structure to copy and which phrases to emphasize* is the product.
- Content mode for the video hero: **project-centric** ("I built X") — cleanest repo→content demo. The blog/site feature covers the person-centric / ongoing-presence mode.

---

## Demo scope (what actually happens on stage)

### Live (must work)
1. **Connect a GitHub repo** → AI pulls it, understands what the project is (purpose, stack, what's interesting).
2. **Reference content** → show a populated "pool" of 50–100 scraped high-performing dev/tech UGC videos (cheap Apify pull, pre-baked) to signal breadth. Live intelligence runs on 1–2 hand-picked matches.
3. **Reverse-engineer → brief → script (HERO, runs live):** analyze the reference video's structure (Gemini-on-video: hook, pacing, on-screen text timing, visual technique) → produce a content structure → a follow-along content brief → a film-ready script with keyword emphasis flagged.
4. **Teleprompter capture** (or upload footage): user reads the script while recording in-browser.
5. **Video render — MUST genuinely work.** Transcript (word-level) → captions + keyword overlays → MP4 via Remotion. This is a real product feature, not staging. Build the actual pipeline.

### Demo-day insurance (NOT the build target)
- A **pre-rendered version of the hero video** kept on hand ONLY as a fallback if the live render is too slow or the venue network/compute is unreliable on stage. The product must render for real; the hardcode exists so a slow render never kills the live pitch. Do not build toward the fake — build the real render, keep the recording as a safety net.
- **Scrape step** → pre-picked reference videos, framed as scraped (pool exists, so honest).

### Secondary (show artifact, don't build the rig)
7. **Blog + portfolio site** the "AI maintains" — person-centric, ongoing presence. Show a generated blog page + LinkedIn draft as static artifacts. Frame as "portfolio manager that researches trending topics (via Exa) and writes from a student's perspective."

### Dropped (do NOT build in 12h)
- 100-video matching algorithm, video-file warehousing, live multi-video scrape at scale, job queue / background workers, real auth/OAuth posting.

---

## The video intelligence (the part that must be visibly better than generic AI)

**Killer demo moment: side-by-side.** "Generic AI script" vs "Reverse-Engineer script (after analyzing what's working in your niche)." If the difference is stark, you win the room.

Pipeline for the hero:
1. Repo → project understanding (what it is, what's interesting, who'd care).
2. Reference video(s) → Gemini-on-video structural analysis (richer than transcript: visual hooks, pacing, on-screen text). Honest claim: "transferable structure," NOT "we cracked virality."
3. Structure + project → content brief (the reusable skeleton, re-skinned).
4. Brief → script with **keyword emphasis flags** (these phrases get overlays). This flag set is what drives the Remotion overlays — the intelligence lives here, not in the renderer.

### Word-level timing (load-bearing detail)
Captions + "overlays based on what they say" REQUIRE **word-level** timestamps, not segment-level.
- Whisper / OpenAI transcription: must explicitly request word granularity (`timestamp_granularities: ["word"]`).
- Mapping to Remotion: `frame = round(seconds * fps)`. The only timing primitive is `<Sequence from={X} durationInFrames={Y}>`.
- Keyword overlays = filter the words array for brief-flagged keywords, mount an animated component at each timestamp.
- VERIFY the Gemini video API behavior + cost/latency at start of build — it's load-bearing and remembered behavior may be stale.

---

## Tech stack

### Frontend
Everything is **one Next.js (App Router) app** — frontend, API routes, and the render pipeline live in the same codebase. No separate backend service to stand up in 12h.

### Frontend (inside the Next app)
- **Next.js App Router + Tailwind + shadcn/ui** — shadcn gives the dense, dark, Cursor-inspired aesthetic cheaply. Add a couple of Tailwind tokens for accent + mono font and it reads "technical IDE" without custom CSS.
- UI is a **review-and-approve pipeline dashboard**, NOT a manual editor (manual editing contradicts the "devs won't do video work" thesis).
- Layout: left = projects/repos; center = brief + script + video preview; right = "why this works" analysis from reference content.
- State: keep it simple — React state + server actions / fetch to the API routes. No Redux, no heavy state lib.

### API routes (inside the Next app — `app/api/*`)
- **Per-step routes**, called in sequence, with progressive "step ✓" UI ("Analyzing repo… ✓ / Reverse-engineering… ✓"). Each step persists state to a DB row.
- NOT one long route (Vercel timeout). NOT a job queue (too slow to build). The progressive UI also demos better — judges watch the agent "think."
- Routes: `analyze-repo`, `reverse-engineer`, `generate-brief`, `generate-script`, `transcribe`, `render`.

### Data + external services (called from the API routes)
- **DB:** Supabase (Postgres) — fast to set up, stores repo analysis, reference video metadata + Gemini analysis JSON (the expensive artifact), generated briefs/scripts.
- **Repo pull:** GitHub API — README + file tree + languages. Repo-level understanding, not commit-level.
- **Scraping:** Apify TikTok scraper — pre-baked pool of 50–100 (cheap), URL + metadata only, no video files.
- **Video analysis:** Gemini video API — structural analysis of reference clips.
- **Transcription:** Whisper / OpenAI with WORD-level timestamps (load-bearing — see timing section).
- **LLM:** for repo understanding, brief, script, keyword-flagging (Claude / GPT / Gemini — your call).

### Render pipeline (the one heavy piece)
- **Remotion** (30fps, simple overlays for speed). **Must genuinely render** transcript→captions→overlays→MP4. Pre-rendered copy kept only as demo-day fallback, not the build target.
- Render is CPU-heavy and slow inside a Vercel serverless route. Two realistic options: (a) render on a small always-on box (this is where **Zo / a cheap VPS** earns its place — it has ffmpeg + Node), or (b) trigger render locally for the demo. Decide early; don't discover the serverless limit at hour 10.

### Sponsor alignment (don't staple — these two fit naturally)
- **Exa** → blog/trend research + content discovery (semantic search > generic scrape). Genuine fit.
- **Zo Computer** → can host the blog + run ffmpeg/Remotion + scheduled repo-monitor (always-on cadence). Genuine fit, but **frame as infrastructure/plumbing, not the star** — Zo's own pitch (scheduled agents that monitor/research/write/post) is dangerously close to the product description. Lead with the vertical intelligence.
- Codex / Cursor → build-time tools, name-drop only.
- Render the hero video for real; keep a pre-rendered copy only as a stage fallback. Never put a flaky early-stage automation on the live demo critical path.

---

## Open risks to have answers ready for
1. **Retention** (VCs will probe): "I shipped, market it once" is episodic. Answer: target user ships *recurringly* (indie hackers, students, regular shippers); ongoing blog/site feature is the recurring surface.
2. **"This is just a content tool"**: Answer: vertical = job-seeking devs + reverse-engineering proven structure + recruiter framing + dev-native distribution. Generic tools target marketers/leads on LinkedIn only.
3. **"Marketing a bad project"**: Stated assumption — the user already built something decent. Tool amplifies real signal; it doesn't manufacture it.
4. **"Why not just ChatGPT?"**: The side-by-side. Reverse-engineered structure from real top performers vs generic generation.
5. **"This is just an agent harness / infra config"**: Lead with the human + the vertical intelligence (reverse-engineering proven structure, recruiter framing); treat pipeline/hosting as plumbing.

## Build priority (where the 12 hours actually go)
1. Repo → project understanding (live).
2. Reverse-engineer → brief → script with keyword flags (HERO, live, must be visibly non-generic).
3. Real render pipeline: word-level transcript → captions + keyword overlays → MP4 (Remotion). Must work.
4. Cursor-style review dashboard (shadcn, fast).
5. Teleprompter capture.
6. Populated pool + secondary blog/site artifacts. Keep a pre-rendered hero clip as stage fallback.
