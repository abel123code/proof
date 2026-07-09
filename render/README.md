# proof — render service (Zo + Remotion)

Turns a raw teleprompter take into a finished short-form clip: word-level transcribe,
cut the dead space and fillers, then burn karaoke captions and keyword/diagram overlays
onto the cut footage. Built to run as a small HTTP service on a Zo Computer.

## Pipeline (one job)

```
recording.mp4  ->  extract audio (ffmpeg)
               ->  transcribe word-level (OpenAI whisper-1)
               ->  cut: filler + dead-space removal -> kept segments
               ->  ffmpeg: concat kept segments -> clean base clip (all-keyframe, CFR 30)
               ->  remap word + cue timings onto the cut timeline
               ->  Remotion: render the caption/overlay layer (transparent ProRes 4444)
               ->  ffmpeg: burn the overlay onto the base clip -> edited.mp4
               ->  upload to Supabase Storage
```

Remotion never touches the source video (no `OffthreadVideo`), so frame-seeking can never
fail. ffmpeg owns the video, Remotion owns the motion graphics.

## HTTP API

- `POST /render` body `{ captureId }` **or** `{ videoUrl, brief }` -> `202 { jobId }`
- `GET /render/:jobId` -> `{ status, mp4Url?, error? }`
  status: `queued | transcribing | cutting | rendering | uploading | done | error`
- `GET /health` -> `{ ok: true }`

`brief` shape: `{ script, keywordFlags: [{phrase, emphasis?}], overlays?: [...] }`.
With `captureId`, the service loads the recording + script straight from Supabase
(`captures` -> `scripts`) and writes back `transcripts` + `renders`.

## Local dev

```
npm install
npm run verify:whisper [media]     # confirm whisper-1 word timestamps
npm run test:local [raw.mov]       # full pipeline -> out/edited-*.mp4 (no DB needed)
npm run server                     # POST /render on :8080
```

Env is read from the repo-root `.env.local` (`OPENAI_API_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

## Deploy on Railway

Live at **https://proof-render-production.up.railway.app** (Railway project `proof-render`).

Three files drive the deploy:

- **`Dockerfile`** — mirrors `zo-deploy.sh setup()`'s apt list (ffmpeg + the chromium shared
  libs `chrome-headless-shell` needs) on `node:22-bookworm-slim`. Everything after
  `USER node` — `npm ci`, `npx remotion browser ensure`, and the runtime — runs as the
  non-root `node` user, because Remotion's headless chromium refuses to sandbox as root.
  `npx remotion browser ensure` pre-warms `chrome-headless-shell` at build time so the
  first real render doesn't cold-download it.
- **`railway.json`** — sets the Dockerfile builder, a `/health` healthcheck (300s timeout),
  and `ON_FAILURE` restarts (max 3 retries).
- **`.dockerignore`** — critically excludes `.env*` from the build context. `src/env.ts`
  loads env files with `override: true`, so a baked-in `.env.local` would clobber whatever
  Railway injects at runtime; keeping it out of the image is what makes Railway's env vars
  authoritative.

```
# from inside render/ — this makes render/ the build context, so no
# root-directory config is needed and there's no GitHub repo coupling
railway up
```

Project: `proof-render`. Public URL: https://proof-render-production.up.railway.app

Required Railway variables (set in the Railway dashboard, not committed anywhere):
`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`. Don't set `PORT` — Railway
injects it.

The Next app needs `RENDER_SERVICE_URL` pointed at the Railway URL above (repo-root
`.env.local` locally, a real env var in prod).

### Railway caveats

- **Job state is in-memory.** A redeploy or restart mid-render loses in-flight jobs; the
  client just has to re-submit.
- **`tmp/` and `out/` are ephemeral.** They don't survive redeploys/restarts. Final MP4s
  for DB-backed jobs (`captureId` requests) are persisted to Supabase Storage — that's the
  durable copy. `videoUrl`-only jobs are served straight from `/out` and are only as
  durable as the current container.
- **First build is slow.** Downloading `chrome-headless-shell` during `npx remotion browser
  ensure` makes a from-scratch build take ~4-5 minutes.

## Deploy on Zo (legacy / alternative)

```
# on the Zo box, in render/
export OPENAI_API_KEY=...  SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...
bash zo-deploy.sh setup      # ffmpeg + chromium libs + npm ci + headless browser
bash zo-deploy.sh start      # run under Zo "process mode" so it stays up
```

Then expose port `8080` (Zo gives an HTTP Proxy URL) and the Next app calls
`https://<zo-host>/render`.

### Zo gotchas to watch

- **Remotion headless chromium** needs the shared libs in `zo-deploy.sh setup`. If a render
  errors with a missing `.so`, install that lib and re-run.
- **Running as root**: if chromium reports a sandbox error, run the service as a non-root
  user, or pass Remotion a no-sandbox chromium option.
- **First render is slow**: Remotion downloads `chrome-headless-shell` once. `setup` does
  this ahead of time via `npx remotion browser ensure`.
- **CPU**: rendering is CPU-bound. A ~30s clip is a few minutes on a modest box.
