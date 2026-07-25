# Music library (background soundtrack)

The render pipeline's **sound-tracking stage** (`src/soundtrack.ts`) picks one track from this folder
per video and mixes it **ducked under the speaker's voice**. Selection is driven by `manifest.json` +
an OpenAI "music director" call; if the call fails or the folder is empty, the stage falls back to a
default track (or no-ops), and the video ships unchanged. Nothing here can break a render.

## What ships here

Ten gentle instrumental tracks (`*.mp3`) by **HoliznaCC0**, from the Free Music Archive. Every track is
**CC0 1.0 Universal (public domain) — no attribution required, safe for commercial use**. They are
lo-fi / ambient / calm beds chosen to sit under a voiceover without competing (the genres recommended
for TikTok talking-head videos). All were loudness-normalized to a consistent bed level (~-20 LUFS) so
the "music director" call's gain choices behave predictably across tracks.

Provenance + license for each file is recorded in `manifest.json` (`source`, `artist`, `license`).

## `manifest.json`

Every playable track needs an entry. The selector and mixer read only the manifest (never the audio):

```jsonc
{
  "id": "calm-drift",           // stable id the model returns
  "file": "calm-drift.mp3",     // filename in this folder (must exist, or it's skipped)
  "title": "Calm Drift",
  "source": "...",              // where it came from (attribution/provenance)
  "license": "...",             // must be royalty-free / no-attribution to ship
  "mood": ["calm", "minimal"],  // tags the model matches against the video's tone
  "bpm": null,
  "description": "..."          // one line the model reads to choose
}
```

## Adding your own tracks (Pixabay / Mixkit / etc.)

Both **Pixabay Music** and **Mixkit** are royalty-free with **no attribution required** and are great
for gentle beds. Their CDNs block automated downloads, so grab tracks in a browser:

1. Download the `.mp3` from the site and drop it into this folder.
2. Add a matching entry to `manifest.json` (fill in real `source` + `license`).
3. That's it — the selector will start considering it on the next render.

Only add tracks whose license permits commercial use without attribution. Keep the `license`/`source`
fields accurate for each file.
