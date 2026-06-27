# Proof — Zo + Remotion Render Service (PRD)

> **Scope of THIS doc:** the render half only — the Zo-hosted service that turns a raw teleprompter recording + a content brief into a finished short-form MP4 (cuts + captions + overlays). Your friend owns the Exa → brief half. This doc defines the two halves' contract so they snap together.
>
> **Repo:** new branch in `github.com/abel123code/proof` (e.g. `feat/zo-remotion-render`).
> **Owner:** Abhishek (Zo + Remotion). **Deadline:** Build2026, 12h, today.

---

## 1. The contract (input/output — the only thing both halves must agree on)

**INPUT to this service** (produced by the Exa/OpenAI pipeline):
- `recording.mp4` — the teleprompter talking-head take (9:16 portrait), uploaded to Supabase Storage. We receive a URL.
- `brief` — JSON the render consumes:

```ts
type Brief = {
  script: string;            // the full script the user read off the teleprompter (load-bearing: enables script-guided cutting)
  keywordFlags: {            // phrases that get an on-screen overlay when spoken
    keyword: string;         // e.g. "word-level timestamps"
    overlayType: "emphasis" | "term" | "stat";
  }[];
  overlays: {                // larger visual overlays (diagram, image, b-roll text card)
    type: "architecture-diagram" | "text-card" | "image";
    anchor: { kind: "keyword"; keyword: string } | { kind: "ratio"; at: number }; // when to show it
    content: string;         // diagram = a mermaid/asset url; text-card = the text; image = url
    durationMs?: number;     // default 2500
  }[];
};
```

**OUTPUT of this service:**
- `edited.mp4` — dead space / filler / mistakes cut, karaoke captions, keyword + diagram overlays. Uploaded to Supabase Storage; URL returned.

> The `script` field is the unlock. Because the user reads a known script off the teleprompter, the render can align the messy transcript to it and cut cleanly. If the Exa pipeline can't emit a clean `script`, fall back to dead-space + filler cutting only (still works, just won't catch retakes).

---

## 2. Architecture — Zo HTTP render API (Option A, confirmed)

```
Browser (Next app)                 Supabase Storage              Zo Computer (Linux, root)
─────────────────                  ───────────────               ─────────────────────────
record 9:16  ──upload──►  recording.mp4
POST /render {videoUrl, brief} ───────────────────────────────►  Express :8080
                                                                  └─ enqueue job, return {jobId}
                                                                     (process-mode background render)
GET /render/:jobId (poll) ◄─────────────────────────────────────  {status, mp4Url?}
show edited.mp4   ◄──────  edited.mp4  ◄────────────upload────────  remotion render → MP4
```

- **Why Option A:** Zo's own pitch is "host an API + run background jobs while you sleep." The render IS that. Direct, fewest moving parts, demos live ("my site calls my cloud computer, it renders, sends it back"). Build it real even if the live demo plays a pre-rendered cut — judges check the repo, so the scaffolding must be legit.
- **Supabase = the file bus** (both halves already use Supabase per the existing repo). No files travel through the Next API; only URLs + the brief JSON.
- **Async + poll** (not synchronous) because a render is 30s–2min — a synchronous HTTP call would time out. `jobId` + status polling avoids it.

---

## 3. The render job (the 7 steps, on Zo)

Single Node worker, triggered per job:

1. **Download** `recording.mp4` from the Supabase URL to Zo's local disk.
2. **Transcribe (word-level)** — OpenAI transcription API with `timestamp_granularities: ["word"]` → `[{text, startMs, endMs}]`. (On Zo, inside the job — the file's already here. Confirmed.) Whisper word-level is load-bearing; verify the exact granularity flag at build start, remembered API behavior may be stale.
3. **Script-guided cut** (§4) → ordered `keepList: {startMs, endMs}[]`.
4. **Remap** every kept word's timestamp from the original timeline to the post-cut timeline (cutting shifts everything; captions/overlays must use the NEW timeline). Produce `words.json` in cut-time + `overlayCues` in cut-time.
5. **Build Remotion props** — the keep segments (for the base video) + `words.json` + `overlayCues`.
6. **Render** — `remotion render Main out/edited.mp4 --codec=h264 --props=props.json` (Yoda's exact CLI pattern).
7. **Upload** `edited.mp4` → Supabase Storage; PATCH job → `done` + url.

---

## 4. The cut engine (the meat — the part that doesn't exist in Yoda)

Input: `transcript[]` (word-level) + `brief.script`. Output: `keepList` of original-timeline segments to keep, back-to-back.

**Three cut passes, in order:**

1. **Filler removal** — drop word-spans matching a filler set: `um, uh, er, like (disfluent), you know, i mean, basically, literally` + standalone false-start fragments. Simple set-match on the word text.
2. **Dead-space trim** — for gaps between consecutive *kept* words > `700ms`, trim the gap to `180ms` padding (keeps natural breath, kills the void). Pure timestamp math.
3. **Mistake / retake removal (script-guided)** — align `transcript` to `brief.script` words via LCS / sequence alignment:
   - Matched run that advances through the script → **keep**.
   - Spoken words with no script match (inserts) → already mostly handled by filler pass; drop the rest.
   - **Repeated script segment** (speaker restarts a sentence: same script span appears twice in the transcript) → keep the **last** occurrence (the clean retake), cut the earlier failed attempt(s).

**Scope ladder (decide by hour 6):**
- **MVP (must work):** passes 1 + 2 (filler + dead space). Reliable, high visible value, low risk.
- **Stretch:** pass 3 (script-guided retake removal). Higher wow, but alignment edge-cases can eat time. If pass 3 is shaky at hour 9, ship MVP — a clean filler+deadspace cut already looks pro.

**keepList → cut timeline:** concatenate kept segments; the new start of word *w* = sum of all kept-segment durations before it. Store `originalMs → cutMs` map for caption + overlay remapping.

---

## 5. The Remotion composition (`Main`)

Portrait **1080×1920, 30fps**. Layers, bottom to top:

1. **Base video, cut** — render only kept segments back-to-back. One `<Sequence>` per keep-segment, each wrapping `<OffthreadVideo src={recording} startFrom={segStartFrame} endAt={segEndFrame} />`, laid out sequentially (`from` = cumulative kept frames). `frame = round(seconds * 30)`.
2. **Karaoke captions** — **reuse Yoda's `AutoSubtitle.tsx` almost verbatim.** It already: groups words into ≤7-word / ≤34-char / 360ms-gap pages, shows the active page, highlights the active word. Swap its `useCaptions(scene)` source from per-scene files to the single post-cut `words.json`. Reuse `config/tokens.ts` SUBTITLE styling.
3. **Keyword overlays** — for each `keywordFlags` entry, find the keyword in the (cut-time) transcript → mount an animated `<KeywordOverlay>` (`spring` in/out) at that timestamp for ~1.5s. Style from tokens (the "technical IDE" accent).
4. **Big overlays** — `overlays[]` (architecture diagram / text-card / image) mounted at their anchor (keyword hit or ratio-through-video), ~2.5s, with a `FadeTransition` (reuse Yoda's). Architecture diagram: render the mermaid/asset as an image, slide it in.

**Reused from Yoda (don't rebuild):** `AutoSubtitle.tsx`, `config/tokens.ts`, `config/timings.ts`, `global/FadeTransition.tsx`, `lib/useCaptions` (re-pointed), the `@remotion/captions` + `@remotion/media-utils` deps, the `remotion render` CLI flow.

---

## 6. Zo setup (one-time, the infra)

On the Zo Linux box (root access confirmed):
- Install: Node (Bun ok) + `ffmpeg` + a headless Chromium for Remotion (`npx remotion browser ensure` or system chrome) + the repo branch.
- `npm i` the render app (Remotion + @remotion/cli + the composition).
- Run the Express server in **process mode** (Zo's background mode — "doesn't count against service limit") so it stays up across the demo.
- Env on Zo: `OPENAI_API_KEY` (transcription), `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (download recording / upload MP4). Exa key NOT needed on this side — that's the friend's pipeline.
- Expose `:8080` (Zo can host an API) → the Next app calls `https://<zo-host>/render`.

---

## 7. Repo layout (new branch `feat/zo-remotion-render`)

```
proof/
  render/                         ← NEW, the Zo service (self-contained)
    server.ts                     Express: POST /render, GET /render/:jobId
    job.ts                        the 7-step render job orchestrator
    transcribe.ts                 OpenAI word-level transcription
    cut.ts                        the cut engine (filler, dead-space, script-align)
    remap.ts                      original→cut timeline remap
    remotion/
      Root.tsx                    registers <Composition id="Main" .../>
      Main.tsx                    the composition (§5 layers)
      AutoSubtitle.tsx            ← copied from Yoda, re-pointed
      KeywordOverlay.tsx          new
      DiagramOverlay.tsx          new
      config/tokens.ts            ← from Yoda
      config/timings.ts           ← from Yoda
      global/FadeTransition.tsx   ← from Yoda
    package.json                  remotion + @remotion/cli + express + openai + supabase
  src/app/api/render/route.ts     ← NEW in the Next app: proxies to Zo, stores jobId on the project row
```

The Next app gets ONE thin route (`/api/render`) that POSTs to Zo and saves the jobId; the dashboard polls it. Everything heavy lives in `render/` on Zo.

---

## 8. Demo + fallback (your worry, noted for the contract)

- Build the real render. Keep a **pre-rendered `edited.mp4`** of the proof-on-proof video as stage insurance (slow render / venue network never kills the live pitch).
- The repo must show the real, working `render/` service — judges check it (Proof of Work 25%). The hardcode is insurance, not the build target.
- Killer demo beat: **side-by-side** — raw take vs the auto-cut+captioned+overlaid output. The cut quality is the visible "this actually works."

---

## 9. Judging alignment (why this scores)

| Criterion | Weight | How this hits it |
|---|---|---|
| Innovation & **central** sponsor use | **30%** | **Zo IS the render runtime** (the heavy compute the product depends on) + Exa IS the brief intelligence. Neither bolted on. Script-guided cutting via teleprompter is a genuinely fresh mechanic. |
| Proof of Work / functionality | 25% | Real Zo service + real Remotion render in the repo, demonstrable end-to-end. |
| Problem fit / market | 25% | Technical job-seekers who build but won't market; recurring shippers = retention. |
| Design, craft & taste | 20% | Yoda-grade captions + overlays; review-and-approve dashboard, not a manual editor. |

---

## 10. Risks + the answers

1. **Whisper word-granularity behaves differently than remembered** → verify the `timestamp_granularities:["word"]` flag + output shape in the FIRST hour. Load-bearing.
2. **Script-guided cut (pass 3) eats time** → it's the *stretch*; MVP (filler + dead-space) ships without it.
3. **Remotion render too slow on Zo** → render at 30fps, simple overlays, `--concurrency` tuned; pre-rendered fallback covers the stage.
4. **`OffthreadVideo` + many cut segments** → if 30+ tiny segments choke, pre-concat the kept segments with ffmpeg into one clean clip first, then Remotion overlays captions on the single clip (simpler, faster). Keep this as the fallback render path.
5. **webm vs mp4 from the browser recorder** → MediaRecorder emits webm on Chrome; ffmpeg on Zo transcodes to mp4 before Remotion ingests. One line.

---

## 11. Build order (where your hours go)

1. Zo: install ffmpeg/chromium/node, Express up in process mode, `GET /health`. (infra first)
2. `transcribe.ts` — verify Whisper word-level shape on a real recording.
3. `cut.ts` MVP — filler + dead-space → keepList; `remap.ts`.
4. `Main.tsx` — base cut video + Yoda `AutoSubtitle`. Render one real MP4 end-to-end. **This is the "it works" milestone — hit it early.**
5. Keyword + diagram overlays.
6. `/render` async contract + Supabase up/download + the Next `/api/render` proxy + dashboard poll.
7. Stretch: script-guided retake cut (pass 3).
8. Pre-render the proof-on-proof fallback clip.
