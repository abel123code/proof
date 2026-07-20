# Proof render service

The render package turns teleprompter footage plus a content brief into a vertical MP4. It
runs as an Express service on Railway or Zo and keeps the heavy ffmpeg, Remotion, Chromium,
HyperFrames, and vision work outside the Next.js process.

## Default pipeline

```text
scene clips
  -> normalize and concatenate at 1080x1920 CFR30
  -> whisper-1 word timestamps with a brief-derived vocabulary prompt
  -> remove fillers and dead space
  -> remap words and scene anchors to the cut timeline
  -> Remotion captions on a transparent ProRes overlay
  -> ffmpeg caption composite
  -> GPT-5.6 Sol scene author
  -> sanitize model HTML
  -> HyperFrames transparent scene render
  -> deterministic speaker and caption alpha mask
  -> five-frame GPT-5.6 Sol vision QA
  -> repair, approve, or omit each scene
  -> ffmpeg final composite
  -> validate dimensions and duration
  -> upload to Supabase Storage
```

The web route and render worker own the mode. Both ignore a caller-supplied `editMode` and default
to `generated-experimental`, which runs the premium author and vision-reviewed path. Set the same
`RENDER_EDIT_MODE` value in both services to select an operator fallback:

- `generated-experimental`: brief-driven bespoke scenes, HyperFrames, safety mask, and vision QA
- `brief-driven`: Luna selects from deterministic Remotion visual templates
- `classic`: legacy captions and fixed overlays

Premium failure falls back to the valid captioned base video. A rejected scene never reaches
the final composite.

## Model roles

- `PREMIUM_PLAN_MODEL=gpt-5.6-sol`
- `PREMIUM_AUTHOR_MODEL=gpt-5.6-sol`
- `PREMIUM_QA_MODEL=gpt-5.6-sol`
- `BRIEF_VISUAL_MODEL=gpt-5.6-luna`

Premium Chat Completions use low reasoning by default. The Luna visual selector uses no
reasoning by default. Premium requests have a 90-second per-attempt timeout and one retry.

Vision review sends five composited PNGs with explicit `detail: "auto"`, which GPT-5.6 treats
as original detail. The parser requires `ok: true` plus an empty issues array. Any parse error
rejects the scene. There is no runtime QA bypass. Premium mode removes fixed keyword chips and
text cards before authoring so rejected graphics remain repairable.

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

## Zo alternative

```bash
cd render
bash zo-deploy.sh setup
bash zo-deploy.sh start
```

Expose port `8080` and point `RENDER_SERVICE_URL` at the proxy URL. Run as a non-root user so
Chromium can use its sandbox.
