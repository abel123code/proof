# Proof render service

The render package turns teleprompter footage plus a content brief into a vertical MP4. It
runs as an Express service on Railway and keeps the heavy FFmpeg, Remotion, Chromium,
HyperFrames, and vision work outside the Next.js process.

## Default pipeline

```text
scene clips
  -> normalize and concatenate at 1080x1920 CFR30
  -> whisper-1 word timestamps with a brief-derived vocabulary prompt
  -> remove fillers and dead space
  -> remap words and scene anchors to the cut timeline
  -> Remotion captions on a transparent ProRes overlay
  -> GPT-5.6 Sol global editorial plan (clean / overlay / full-frame)
  -> deterministic coverage and recovery budgets
  -> GPT-5.6 Sol scene author with one shared visual system
  -> sanitize model HTML
  -> HyperFrames transparent scene render; FFmpeg optionally hard-cuts full-frame beats to black
  -> deterministic caption-band alpha mask for overlays; readable graphics may overlap the face
  -> five-frame GPT-5.6 Sol vision QA
  -> repair, approve, or ship flagged with an auditable report
  -> ffmpeg scenes over clean footage
  -> ffmpeg captions LAST
  -> validate dimensions and duration
  -> upload to Supabase Storage
```

The web route and render worker own the mode. Both ignore a caller-supplied `editMode` and default
to `generated-experimental`, which runs the premium author and vision-reviewed path. Set the same
`RENDER_EDIT_MODE` value in both services to select an operator fallback:

- `generated-experimental`: creator-native global planning, HyperFrames overlay/full-frame scenes,
  mode-aware safety, captions-last composition, and vision QA
- `brief-driven`: Luna selects from deterministic Remotion visual templates
- `classic`: legacy captions and fixed overlays

Premium failure falls back to the valid captioned base video. A scene with unresolved issues ships
flagged; only unrenderable or unsafe HTML uses the per-beat base fallback.

## Model roles

- `PREMIUM_PLAN_MODEL=gpt-5.6-sol`
- `PREMIUM_AUTHOR_MODEL=gpt-5.6-sol`
- `PREMIUM_QA_MODEL=gpt-5.6-sol`
- `BRIEF_VISUAL_MODEL=gpt-5.6-luna`
- `MUSIC_MODEL=gpt-5.6-sol` — the post-edit "music director" that picks a background track

## Soundtrack

After the video is edited (visuals + captions), the `scoring` stage mixes a gentle background track
**ducked under the speaker's voice** (sidechain compression + fades). The `MUSIC_MODEL` call picks one
track from `assets/music/` (see its `manifest.json`) and its mix levels; on any failure it falls back to
a neutral default track. The stage is best-effort: with `RENDER_MUSIC=0`, an empty library, or any
error, the video ships unchanged. Bundled tracks are synthesized, license-free ambient pads — drop your
own royalty-free (no-attribution) tracks into `assets/music/` and add a manifest entry to expand the set.

- `RENDER_MUSIC`, default on; set `0` to disable scoring
- `MUSIC_MODEL` / `MUSIC_EFFORT`, the track-selection model + reasoning effort

Premium Chat Completions use low reasoning by default. The Luna visual selector uses no
reasoning by default. Premium requests have a 90-second per-attempt timeout and one retry.

Vision review sends five final-order composites (footage, scene, captions) with explicit
`detail: "auto"`. Overlay QA protects the caption band and prioritizes complete mobile-readable wording
over face visibility. Full-frame QA uses the planned background: black takeovers treat the absent speaker
as intentional, while footage-backed scenes allow face overlap. There is no runtime QA bypass.
Subjective notes never drive an automatic re-author.

The global plan preserves at least 25% clean A-roll, caps full-frame coverage at 40%, caps overlay
coverage at 35%, keeps the opening and closing face-led, and preserves a three-second clean interval
for videos longer than 30 seconds. `premium/edit-plan.json` records the selected modes and coverage.

## HTTP API

- `POST /render` accepts `{ captureId }`, `{ videoUrl, brief }`, or
  `{ jobId, briefId, videoUrls, brief }` and returns `202 { jobId }`. Any supplied `editMode` is
  ignored.
- `GET /render/:jobId` returns `{ status, mp4Url?, error? }`
- `GET /health` returns `{ ok: true }`

Statuses include `queued`, `transcribing`, `cutting`, `planning`, `rendering`,
`quality-checking`, `uploading`, `done`, and `error`.

The brief accepts:

```ts
{
  script: string;
  keywordFlags: Array<{ phrase: string; emphasis?: string }>;
  hook?: string;
  targetFeeling?: string;
  scenes?: Array<{
    label: string;
    spokenLine: string;
    onScreenText?: string;
    brollCue?: string;
    durationSeconds?: number;
  }>;
  assets?: {
    images?: string[];
    brandColor?: string;
    brandVoice?: string;
    motif?: string;
  };
}
```

## Local development

The service loads the repo-root `.env.local`.

```bash
cd render
npm ci
npm run check
npm run test:unit
npm run verify:whisper -- <media-file>
npm run test:local -- <raw-video>
npm run server
```

Required values:

- `OPENAI_API_KEY`
- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Useful controls:

- `RENDER_CONCURRENCY`, default `2`
- `PREMIUM_CONCURRENCY`, default `2`
- `PREMIUM_MAX_QA_ITERS`, default `2`
- `PREMIUM_OPENAI_TIMEOUT_MS`, default `90000`
- `PREMIUM_ASSET_HOSTS`, comma-separated HTTPS host allowlist
- `RENDER_EDIT_MODE`, default `generated-experimental`
- `RENDER_TOKEN`, optional shared secret for `x-render-token`

## Durable jobs

Apply [`../supabase/migrations/0013_render_jobs.sql`](../supabase/migrations/0013_render_jobs.sql).
Vercel creates each `render_jobs` row. Railway updates phase and progress, uploads the final
MP4, and marks the row complete. On restart, Railway reclaims queued jobs and processing jobs
whose lock is older than 15 minutes.

The in-memory table and `/out` route remain for local and legacy requests. DB-backed jobs use
Supabase as the durable source of truth.

## Railway

The current project is `proof-render`, with the configured public URL
`https://proof-render-production.up.railway.app`.

`Dockerfile` installs ffmpeg and Chromium libraries on Node 22 Bookworm, switches to the
non-root `node` user, runs `npm ci`, and preloads Remotion's headless browser.

```bash
cd render
railway up
```

Set the required values in Railway. Leave `PORT` to Railway. If `RENDER_TOKEN` is enabled,
configure the same value in the Next.js deployment.

`tmp/` and `out/` are ephemeral. DB-backed final videos are uploaded to Supabase Storage.

## Remote smoke test

After deployment, run the same public request and polling path against the live worker:

```bash
npm run test:remote -- <local-clip> https://proof-render-production.up.railway.app
```
