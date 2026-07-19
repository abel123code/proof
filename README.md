# Proof

**You build. We get you seen.**

Proof turns a developer's GitHub work into a short-form video they'd actually post. Connect your GitHub, and Proof extracts your uniquely shareable "proof", researches what dev audiences are talking about right now (via an in-app OpenAI web-search agent), mines the patterns behind winning videos, and ranks concrete angles by **predicted virality**. Pick one, get a scene-by-scene brief grounded in your real work, film it in the browser teleprompter, then auto-cut, caption, and overlay it into a finished vertical MP4.

**Live at [tryproof.org](https://www.tryproof.org/)** — invite-only beta (gated onboarding, capped at 50 builders, per-user credits).

Built at **'Sup · Build2026**, where it placed **1st Runner-Up (2nd) out of 300+ builders**.

---

## Why

Shipping is easy now; getting people to *use* what you ship isn't. Traction comes from marketing — the one thing most developers won't do. So the best work goes unseen. Proof is the marketing co-pilot for people who build but don't post.

---

## How it works

```
github → proof + web-search research → scored angles → brief → teleprompter → cut → render → mp4
```

The product is two halves that meet over HTTP, with Supabase as the file/data bus:

```mermaid
flowchart LR
  subgraph web [Next.js app - Vercel]
    connect["01 Connect GitHub"]
    research["02 Research & Plan (web search)"]
    brief["03 Brief & Film"]
  end
  subgraph render [Render service - Railway]
    api["Express /render"]
    job["transcribe → cut → caption/overlay → composite"]
  end
  supa[("Supabase\nAuth + DB + Storage")]

  connect --> research --> brief
  brief -- "videoUrls + brief" --> api
  api --> job
  job -- "edited.mp4" --> supa
  web <--> supa
  job -. "polls status" .-> brief
```

- **The web app** (this repo root) owns the intelligence + capture: GitHub understanding, the virality research engine (OpenAI web search), the scored content plan, the brief, and the in-browser teleprompter/recorder — behind GitHub-OAuth gated onboarding.
- **The render service** (`render/`, deployed on **Railway**) owns the heavy compute: word-level transcription, script-guided cutting, and Remotion caption/overlay rendering — the full Linux + ffmpeg + headless-Chromium workload serverless can't hold.

---

## The pipeline (stages)

| Stage | Route | What happens | Powered by |
|---|---|---|---|
| 01 Connect GitHub | `/connect` | Scan a user's public repos + activity, build a profile of what they actually ship | Octokit + OpenAI (mini) |
| 02 Research & Plan | `/research` | Extract shareable **proof** → research trending/content-gap topics → mine reference **patterns** → generate and **virality-score** angles. Or start a brand-new video from a freeform prompt. | OpenAI **web search** (Responses API) |
| 03 Brief & Film | `/brief` | Info-gap Q&A → a scene-by-scene, filmable brief grounded in the chosen angle. Teleprompter records each scene (true 9:16) to Supabase Storage. "Send to editor" ships it to the render service | OpenAI + Supabase + render service |

The landing page at `/` is the pitch deck (`public/proof-deck.html`); its CTA drops into the demo at `/connect`. Auth: `/login` (GitHub OAuth) → `/auth/callback` → `/pending` if not yet approved.

### The virality engine (`src/lib/research.ts`)

North star: engineer for **algorithmic satisfaction signals** (completion, shares, saves, rewatches), not likes. The engine runs:

1. **Proof extraction** — the uniquely shareable receipts from your repos (cheap tier, cached per project).
2. **Trend & demand research** — current dev/AI waves + content-gap (blue-ocean) topics with real sources. **Run once/day globally and shared across all users** (24h cache), so web-search spend is near-zero.
3. **Reference pattern mining** — patterns behind top-performing analogous videos (cited, not downloaded). Cached per topic.
4. **Angle generation + scoring** — several angles scored on a rubric (hook archetype, emotional trigger, shareability, save-ability, trend fit, authenticity) and ranked. This is the one premium model call.

### The bespoke-scene engine (premium tier)

For designed scenes rather than captioned talking-head footage: an LLM **storyboards** each scene, the scene is **rendered programmatically**, and a **vision model QAs the rendered frames** and flags failures for re-render. The known script is also fed to whisper as a vocabulary prompt so domain terms transcribe correctly. See `DECISIONS.md` (2026-07-14).

---

## Tech stack

- **Web:** Next.js (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui · Fraunces / Hanken Grotesk / Geist Mono
- **Auth:** Supabase Auth (GitHub OAuth) via `@supabase/ssr` + middleware; approved allowlist + per-user credits
- **Data:** Supabase (Postgres + Storage), RLS on all public tables
- **AI:** OpenAI — model-tiered: `gpt-5.4-mini` for mechanical steps (understanding, proof, brief draft), `gpt-5.5` for angle generation + scoring, and the **web-search** tool (Responses API) for grounded research. Whisper (in the render service) for transcription. A vision model QAs bespoke scenes.
- **Render:** Express · Remotion · ffmpeg · headless Chromium, containerised on **Railway**

### Cost model
LLM cost is controlled deliberately: **model tiering** (premium only for the one step where quality drives the outcome), **shared caching** (trends computed once/day globally; references per-topic; proof per-project), a stable system-prompt prefix for OpenAI prompt-cache discounts, and capped `max_output_tokens`. Expensive steps run only on explicit user action, behind the credit gate — never on page load.

---

## Repository layout

```
proof/
├─ src/
│  ├─ middleware.ts               # Supabase session refresh + route gating
│  ├─ app/
│  │  ├─ page.tsx                 # landing (pitch deck iframe)
│  │  ├─ login/ pending/ auth/callback/   # gated onboarding (GitHub OAuth)
│  │  ├─ connect/ research/ brief/         # the 3 pipeline stages
│  │  └─ api/                     # analyze-repo, research, angles, brief/*, footage, render
│  ├─ components/studio/          # stage panels, teleprompter, header/stepper
│  └─ lib/                        # github, openai, research, content-brief, auth,
│  │                              # supabase/{server,client}, db, render-brief…
├─ supabase/migrations/           # 0001 … 0015 schema (0007 auth, 0008 usage, 0009 cache,
│                                 # 0011 credits, 0012 RLS lockdown, 0013 render jobs,
│                                 # 0014 onboarding tour, 0015 bug reports)
├─ public/                        # hero.png, proof-deck.html, demo-render.mp4
└─ render/                        # the render service (self-contained, its own README)
```

The render service has its own setup notes in [`render/README.md`](render/README.md). Deployment write-up: [`docs/2026-07-09-railway-render-deploy.md`](docs/2026-07-09-railway-render-deploy.md).

---

## Getting started (web app)

### Prerequisites
- Node 18.18+ (Node 20 recommended)
- A Supabase project (with GitHub OAuth configured — see below)
- API keys: OpenAI (GitHub token optional)

### 1. Install
```bash
npm install
```

### 2. Environment
Create `.env.local` in the repo root (see `.env.example`):

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...      # client auth (GitHub OAuth). If unset, auth is disabled (dev)
SUPABASE_SERVICE_ROLE_KEY=...          # server-only, never expose to the client

# AI
OPENAI_API_KEY=...
GITHUB_TOKEN=...                       # optional, raises GitHub rate limits

# Model tiering (optional overrides; defaults shown)
OPENAI_TEXT_MODEL=gpt-5.5              # premium: angle generation + scoring
OPENAI_MINI_MODEL=gpt-5.4-mini         # cheap: understanding, proof, brief draft
OPENAI_SEARCH_MODEL=gpt-5.5            # web-search research (Responses API)

# Quotas
RESEARCH_DAILY_LIMIT=10                # scored-angle runs per user per day

# Render integration
RENDER_SERVICE_URL=https://proof-render-production.up.railway.app
RENDER_TOKEN=...                       # must match the render service's RENDER_TOKEN

# Demo insurance (optional): skip the live render and play a pre-rendered MP4
NEXT_PUBLIC_DEMO_RENDER_URL=/demo-render.mp4
```

> **Note:** `EXA_API_KEY`, `APIFY_API_TOKEN`, and `GEMINI_API_KEY` are no longer used in v2.
> **Never commit env files.** `.gitignore` covers `.env*` **and** a dotless `env`.

### 3. Database
Run the SQL migrations in `supabase/migrations/` (0001 → 0015) in the Supabase SQL editor (or via the Supabase CLI). `0005` creates the public `footage` Storage bucket; `0007` adds auth profiles + allowlist + RLS; `0008` usage quotas; `0009` the shared research cache; `0011` credits; `0012` the RLS lockdown on all remaining public tables; `0013` render jobs; `0014` the onboarding tour; `0015` bug reports.

### 3b. Auth + onboarding (GitHub OAuth)
1. In the Supabase dashboard → **Authentication → Providers → GitHub**, enable it and paste a GitHub OAuth app's client id/secret. Set the callback to `https://<your-supabase-ref>.supabase.co/auth/v1/callback`.
2. In your GitHub OAuth app, set the homepage/callback to your deployed web app.
3. Approve a user by inserting a row into `allowed_users` (match by `email` or `github_username`). On first sign-in an approved user gets a `profiles` row (capped at 50); everyone else lands on `/pending`.

If `NEXT_PUBLIC_SUPABASE_ANON_KEY` is unset, auth is bypassed locally with a single dev identity so the pipeline stays usable.

### 4. Run
```bash
npm run dev       # http://localhost:3000
npm run verify    # typecheck + tests
```

---

## Render service (Railway)

The `render/` package turns per-scene recordings + a brief into a finished MP4. It runs as an Express service in a container on **Railway** (`https://proof-render-production.up.railway.app`). *(It originally ran on a Zo Computer during the hackathon; migrated 2026-07-10 — see `DECISIONS.md`.)*

```bash
cd render
npm install
npm run server        # POST /render on :8080
```

Its env: `OPENAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`, optional `RENDER_TOKEN` (shared-secret auth) and `RENDER_CONCURRENCY` (default 2).

**API**
- `POST /render` body `{ videoUrls[], brief }` (multiple per-scene clips, concatenated) — or `{ videoUrl, brief }`, or `{ captureId }` — → `202 { jobId }`
- `GET /render/:jobId` → `{ status, mp4Url? }` where status is `queued | transcribing | cutting | rendering | uploading | done | error`
- `GET /health` → `{ ok: true }`

`brief` shape: `{ script, keywordFlags: [{phrase, emphasis?}], overlays?: [...], accentColor? }`. The web app builds this from the scene brief in `src/lib/render-brief.ts`.

**Concurrency:** renders are gated by a semaphore, default **2** (measured — 3 concurrent OOMs ffmpeg). Excess jobs stay `queued`. See `DECISIONS.md` (2026-07-10).

Deploy notes (Dockerfile, ffmpeg + headless Chromium, browser pre-warm) live in [`render/README.md`](render/README.md).

---

## The web ↔ render contract

When you click **Send to editor** on the brief:
1. `POST /api/render` forwards your per-scene footage URLs + the mapped brief to the render service and stores the `jobId` on the brief row.
2. The brief page polls `GET /api/render?jobId=…&briefId=…`.
3. On `done`, the finished MP4 is downloaded from the render service, re-uploaded to our Supabase Storage (so it persists), and saved on the brief — then shown in a popup.

---

## Demo mode

For a reliable live pitch, set `NEXT_PUBLIC_DEMO_RENDER_URL=/demo-render.mp4` and drop a pre-rendered clip at `public/demo-render.mp4`. In this mode, **Send to editor** fakes the pipeline progress and plays that file (no render/Supabase round-trip). Set the var empty to use the real pipeline.

## Credits & quotas

Each user has a **credit wallet** (see the `credits` tables): new users start with **1000 credits (~5 videos)**. Credits are charged on render and confirmed on completion, so a failed job doesn't burn the balance. Scored-angle research runs are separately rate-limited on a rolling daily window (`RESEARCH_DAILY_LIMIT`, default 10).

---

## Deploy

- **Web app → Vercel:** import the repo (Next.js auto-detected, root directory = repo root; `render/` is ignored via `tsconfig.json` + `eslint.config.mjs`). Add the env vars above — **including `RENDER_SERVICE_URL` and `RENDER_TOKEN`**, or renders 401 / hit localhost. Note: the web-search research route can be slow on a cold cache — the daily-shared trend cache means only the first user of the day pays that cost.
- **Render service → Railway:** see `render/` + `docs/2026-07-09-railway-render-deploy.md`.

---

## Team

- **Abel** — web app: Connect → Research → Brief, teleprompter, auth, credits, waitlist
- **Abhishek** — render service (transcribe, cut, caption, overlay), Railway deploy + concurrency, the bespoke-scene engine, security hardening, branding

Built in ~12 hours for 'Sup · Build2026 — **1st Runner-Up (2nd of 300+ builders)** — and productionised into an invite-only beta since.
