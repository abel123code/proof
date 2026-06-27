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

## Deploy on Zo

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
