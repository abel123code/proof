# proof — video animation pipeline roadmap

Living tracker. Goal: close the gap between proof's current output ("subtitles in a fancier box")
and the hand-made SUTD benchmark (bespoke motion that means something).

## The core diagnosis

- **Default path today (`brief-driven`, `visual-planner.ts`):** GPT-4o is already called — but its
  job is *"choose exactly one of 7 fixed templates (hook, keyword, metric, comparison, steps, quote,
  payoff) + write a 2–6 word headline."* It's a **template-picker, not a designer.** The visual
  vocabulary is 7 Remotion shapes holding shortened script text. That is exactly why it reads generic.
- **SUTD benchmark:** each beat got a **bespoke motion metaphor** — deadline chips *split into two
  silos*, a hidden card *punches up* on "boom", rows *fly out of the two logos* to assemble one list.
  None of that is derivable from the transcript; it came from understanding the product.
- **The bespoke engine already exists** — the `premium` path (`render/src/premium/*`: GPT storyboard →
  HyperFrames HTML → GPT-4o vision-QA loop) — and has **never run end-to-end.** That's the miss.
- **The OpenAI key is already wired and used** (both modes). The lever is the *renderer architecture*
  (fixed-templates → agent-authored HTML), not "attach the key."

## Two reference workflows (what "good" actually needs)

**Our SUTD run** (`SUTD Deadline Centre demo/PROOF-PIPELINE-UPGRADES.md`), ranked by leverage:
1. Agent-authored bespoke scenes + a frame-level **visual-QA loop** ★ biggest lever
2. Per-project **assets folder** (screenshots, logos, real product UI) ★ high
3. Script-as-prompt to whisper ✓ shipped
4. Multi-take **crop/framing normalization** (heads jump between cuts) ★ high
5. Recurring-**motif** continuity (one object transformed across scenes)
6. HyperFrames as the bespoke renderer ✓ (premium uses it)
7. **Vibe spec + scene seeds + "make more like these"**
8. librosa beat-sync (music formats only)

**JeffGwoah's music-video workflow** (external, converges on the same shape):
- a folder: track + vocals-only + a few assets (screenshots, cover) + `lyrics.md`
- stable-whisper for sync (lyrics provided up front)
- told it the vibe (semi-realistic UI, "creatively show text through the UI")
- seeded a few concrete scene ideas + "make more scene ideas in that style"
- marked the beat drops → Claude used librosa for bpm/energy
- **model mattered:** *"Fable one-shotted almost every scene; Opus struggled with continuity."*
  proof uses **GPT-4o**, the weakest choice for authoring bespoke scenes.
- made **zero** assets/animations by hand

**Convergence:** assets folder + script/lyrics + vibe + seed-scenes + "make more" + a capable model +
visual-QA. proof has the *skeleton* (premium path) but is missing the *inputs* (assets, seeds, vibe),
the *model tier*, and it has never been exercised.

## Track A — Animation engine (the differentiator)

| Feature | Source | Status | Effort |
|---|---|---|---|
| Run premium path end-to-end (**spike**) | SUTD #1 | built, never run | S — running now |
| Feed `brief.scenes` / vibe / seed-scenes INTO `planScenes` (today it re-storyboards from the script and **ignores the brief's own scenes**) | SUTD #7, JeffG | gap | S |
| Assets folder + upload UI (embed real product UI/logos into scenes) | SUTD #2, JeffG | `RenderAssets` type + secured fetch exist; no UI, `planScenes` doesn't consume assets yet | M |
| Model tier for authoring (Claude / Fable vs GPT-4o) | JeffG | gap | S–M |
| Recurring-motif continuity | SUTD #5 | `motif` field exists, weakly used | S |
| Vision-QA loop actually gates slop | SUTD #1 | built, unexercised | S (validate in spike) |
| Multi-take crop / face normalization | SUTD #4 | gap (heads jump between cuts) | M |
| connect-repo → extract brand (colors/tone/UI) | Abel/user | gap | M |

## Track B — Transcription / timing
- stable-whisper or Groq whisper-large-v3 for tighter word timing (whisper-1 today). S–M.
- librosa beat-sync — only if music-led formats are added. Defer.

## Track C — Product / UX + growth (independent, low-effort, ship regardless of A)
- **Upload filename + per-scene preview/play** — real pain (many recordings, can't confirm the right file). S. *(in progress)*
- **CTA after render** — none today. S.
- **Share to LinkedIn / X** — the viral loop; they're making it *for* socials. S–M.
- Mass-upload auto-populate scenes. M. Defer.

## Recommended sequence
1. **Spike (now):** premium vs brief-driven on the SUTD take → decides whether A is the direction.
2. **If spike clears the bar:** Track A core = feed the brief into `planScenes` + assets folder + model tier + confirm vision-QA gates slop. This is the product.
3. **Parallel:** Track C quick wins (filename ✓, CTA, share) — cheap, shippable no matter what A does.
4. Track A polish: crop normalization, brand extraction.
5. Track B when a format needs it.

## Model + speed decision (2026-07-15) — benchmarked

Pricing (OpenAI, per 1M tokens in/out, standard tier): gpt-5.5 $5/$30 · gpt-5.4 $2.50/$15 ·
gpt-5.4-mini $0.75/$4.50 · gpt-5.4-nano $0.20/$1.25 · gpt-5.6-luna $1/$6 · gpt-5.6-terra $2.50/$15.
Empirical latency (single author call, this account): gpt-5.5 eff=medium 16.2s · gpt-5.5 eff=low 9.2s
(~40% faster, same model) · gpt-5.4-mini eff=low 4.8s · gpt-5-mini eff=low 21.7s. `reasoning_effort`
= low/medium/high; **minimal is rejected**; gpt-5.x reject a custom `temperature`.

**Decision (target ~41min → ~4-6min, ~$0.25/video):**
- **Author** (writes the HTML — needs quality): `gpt-5.4` @ `reasoning_effort=low` (half the price of
  5.5, faster, near-equal quality — validate against 5.5 on a real brief). Keep gpt-5.5 as a "max" tier.
- **QA + storyboard** (judges, not authors): `gpt-5.4-mini` @ `low` — 6× cheaper, plenty for verdicts.
- **Parallelize** scene author+render+QA (concurrency cap ~3) — the real wall-clock win: sum → max.
- **`MAX_QA_ITERS=1`** — one author+render+QA round per scene by default.
- All models/efforts behind env vars (`PREMIUM_AUTHOR_MODEL`, `PREMIUM_*_EFFORT`, `PREMIUM_CONCURRENCY`)
  so the tier is tunable without a redeploy. Premium path stays behind the render-credit gate.

## Open questions
- **~~Model + cost~~** — decided above.
- **Does the vision-QA loop actually catch slop, or rubber-stamp everything?** (the spike will show)
- **Assets:** how does a user provide them — upload a folder, or connect-repo auto-extract? (fetch is now https + allowlist only, no local paths, post the SSRF fix.)

## Spike result (2026-07-15) — ran proof's REAL pipeline on the clean SUTD base, both modes

**Verdict: the bespoke architecture works and is safe, but naive "turn on premium" (GPT-4o, no
assets, script-only storyboard) produces the same text-card slop as the vending machine. It does
NOT approach the hand-made bar. The gap is now explained with evidence and it's fixable.**

Evidence (controlled A/B, same footage + same script):
- **brief-driven** (vending machine): talking head + karaoke captions + one keyword chip. No scene
  metaphors, as expected.
- **generated-experimental** (bespoke engine, first-ever end-to-end run): storyboarded **6 scenes** →
  authored → rendered → vision-QA. **3/6 approved, 3 QA-rejected** ("text over the speaker's face" /
  "headline too long" / "repeating the bottom captions") and skipped → those beats fell back to
  captions. **All 6 authored "scenes" were the identical thing: a 2-word headline + a small underline,
  top-left** ("Problem Platforms", "Realization", "Manual Burden", "Streamline Deadlines", "Calendar
  Integration", "Get It Now"). No motion metaphor, no product UI. Output ≈ brief-driven.
- **hand-made gold**: every beat a real visual argument (logos with puppet strings, chips splitting
  into two silos, a MISSED card, a recreated Telegram chat, the real Deadline Center popup with a face
  PiP, the Chrome Web Store card).

What it proves:
- ✅ Mechanism sound + safe: ran end-to-end, QA loop is real (rejected half), fallback works, no
  garbage shipped.
- ✅ QA enforces **cleanliness** (no text over face, short headlines) — but **not creativity** (never
  rejects "this is just a headline").
- ❌ Output with GPT-4o + 0 assets + script-only storyboard ≈ the vending machine.

The 4 levers that separate proof-auto from the gold (evidence-based, in priority order):
1. **Assets are the #1 lever.** The gold's scenes *were* the real logos / extension UI / Chrome-store
   card. With 0 assets the author has only words → text cards. Assets folder + pass asset filenames to
   the author is non-negotiable.
2. **Feed the brief's own scene ideas.** `planScenes` ignores `brief.scenes` — the brollCues ("logos
   slam", "chips split", "Telegram chat") were discarded. planScenes + author must consume them.
3. **Rewrite the author prompt + upgrade the model.** The prompt lets GPT-4o default to headlines; it
   must DEMAND product-UI recreation / a motion metaphor. GPT-4o is the weak link (JeffGwoah: Fable/Opus
   one-shot scenes, 4o doesn't) → a stronger authoring model behind a premium credit tier.
4. **Add a creativity gate to QA** ("reject a scene that is only a headline; require a visual beyond text").

**Bottom line:** Track A is the right bet, but it's a real build (assets pipeline + author-prompt/model
overhaul + feed-brief-scenes + creativity-QA), **not a feature-flag flip.** "Attach the OpenAI key /
turn on premium" alone reproduces the slop — proven, not asserted.

## Spike 2 result (2026-07-15) — assets + real prompts + gpt-5.5 = SOLVED

Re-ran the bespoke path with the three fixes the first spike pointed at. **Decisive win: it now
produces scenes that feature the real product UI and rival the hand-made gold — fully automated.**

What changed vs spike 1:
1. Fed the **real assets** (SUTD screenshots `main-view/course-filter/calendar-export.png` + logos).
2. **Flipped the author prompt** — it was literally ordering "a short 2-5 word headline"; now it MUST
   build a visual around the asset and headline-only cards are banned.
3. **Flipped the QA prompt** — it was *failing* scenes with "text longer than a headline"; now it
   rejects text-only cards.
4. **Model gpt-4o -> gpt-5.5** (dropped `temperature`, which gpt-5.x rejects).

Result: **6/6 scenes approved** (vs 3/6, all text cards). Frames show real logos as puppet-master
tiles, deadline chips splitting into two silos, a MISSED countdown card, the actual Deadline Center
screenshot in a device frame, UI feature callouts, and a Chrome Web Store CTA card. `render/out/spike2-premium.mp4`.

Caveats / productionization work:
- **Speed is the blocker.** gpt-5.5 authoring is slow — 6 scenes took ~41 min (one scene 16 min with a
  retry). Needs: a faster/tiered model, parallel scene rendering, fewer QA retries, caching.
- Judged on frames, not motion — confirm the animation quality by watching the clip.
- Intents were hand-written in the harness. Productionizing = `planScenes` must generate intents this
  rich from `brief.scenes` + the uploaded assets (feed both in; the new author/QA prompts stay).

**Verdict: Track A is validated — build it.** Next: (1) the assets-upload UI (MVP: screenshots + logo
+ brand color), (2) wire `planScenes` to consume `brief.scenes` + assets, (3) a model/speed tier
(premium credits), (4) keep the new author/QA prompts. The engine architecture was right all along;
it was starved and mis-prompted.

## Task 6 e2e (2026-07-15) — PRODUCTIONIZED path on the SUTD base, real pipeline, two model tiers

Ran the *productionized* engine (PR #8: `runJob` -> transcribe -> cut -> caption -> `planScenes(brief.scenes)`
-> parallel author/QA -> composite) on the SUTD base take, with a realistic brief carrying 6 scene ideas
(medium-detail brollCues, NOT the hand-perfected spike intents) + 7 real assets (4 SVG logos + 3 PNG
screenshots). A/B on the author model:

| Run | Author | Retries | Scenes rendered | Wall-clock |
|---|---|---|---|---|
| A | gpt-5.4 @ low | 1 | **1/4** | 754s |
| B | gpt-5.5 @ low | 2 | **2/4** | 884s |

**Proven:** (1) plumbing works end-to-end — `brief.scenes` drove the storyboard (no LLM re-storyboard),
assets fetched, parallel render, QA gated, safe caption-fallback for rejects, no garbage shipped.
(2) **Passing scenes are genuinely good** — frames show the real Deadline Center screenshot in a browser
chrome frame, the split-into-two-silos metaphor with brand-accent deadline chips, proper headlines, face +
caption band clear. Rivals the hand-made gold for those beats. (3) QA is real — rejects generic-icon
substitutes with specific feedback, no rubber-stamping.

**NOT working — and the model tier is NOT the lever:**
- **Pass rate 1–2 of 4.** gpt-5.5 + 2 retries only moved 1/4 -> 2/4 for ~2x the cost. Both models fail
  the SAME thing: embedding the provided **logos into complex metaphors** (puppet-strings, split-silo
  headers) — they substitute generic icons; QA correctly rejects. Simple asset layouts (CTA card,
  screenshot payoff) pass.
- **6 -> 4 scene drop.** `scenesFromBrief` anchor/de-overlap silently dropped 2 of 6 brief scenes before
  rendering. Deterministic (same in both runs).
- **Speed** 12–15 min, but ~4 min is fixed cost (Windows transcribe + final 1908-frame Remotion composite);
  less on Linux/Railway. Not the headline issue.

**REAL fix list (replaces "just use a bigger model"):**
1. **Deterministic asset-inclusion gate** — before rendering, assert the HTML actually `<img src>`'s the
   asset the intent named; if not, re-prompt specifically. Cheaper + more reliable than a bigger model.
2. **Rasterize logos to PNG** (or provide both) — the author handles PNG screenshots far better than SVG
   logos; SVG-logo-in-metaphor is the consistent failure.
3. **Fix the anchoring** so all brief scenes survive (nudge overlaps, don't drop).
4. **Keep `MAX_QA_ITERS=2`** (done, PR #8) — the 2nd retry recovers scenes off QA feedback.
5. Model default: keep **gpt-5.4** (5.5 not worth 2x for +1 scene) UNLESS 1–3 are done first.

PR #8 plumbing is correct + mergeable; the pass-rate levers above are follow-ups, not blockers.
