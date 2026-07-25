import { rename, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getOpenAI } from "./openai.js";
import { chatTuning, premiumRequestOptions } from "./premium/model-params.js";
import { mixMusicUnderVoice, hasAudioStream, probeVideo } from "./ffmpeg.js";
import { RENDER_ROOT } from "./render.js";
import type { RenderBrief, Word } from "./types.js";

export const DEFAULT_MUSIC_MODEL = "gpt-5.6-sol";
const MUSIC_MODEL = process.env.MUSIC_MODEL || DEFAULT_MUSIC_MODEL;
const MUSIC_EFFORT = process.env.MUSIC_EFFORT;

/** Absolute path to the bundled gentle-music library. */
export const MUSIC_DIR = join(RENDER_ROOT, "assets", "music");

export interface Track {
  id: string;
  file: string;
  title?: string;
  source?: string;
  license?: string;
  mood?: string[];
  bpm?: number | null;
  description?: string;
  /** Absolute path to the resolved audio file. */
  path: string;
}

export interface MixParams {
  musicGainDb: number;
  duckAmountDb: number;
  fadeInMs: number;
  fadeOutMs: number;
}

/**
 * Default bed. The library is pre-normalized to ~-20 LUFS and the voice to -14 LUFS, so the track
 * already sits ~6 dB under the voice at unity — musicGainDb is only a small trim (NOT an attenuation
 * to silence). A near-zero trim keeps the bed clearly audible; ducking pulls it down under speech.
 */
export const DEFAULT_MIX: MixParams = {
  musicGainDb: -3,
  duckAmountDb: 7,
  fadeInMs: 1200,
  fadeOutMs: 2500,
};

interface RawTrack {
  id?: unknown;
  file?: unknown;
  title?: unknown;
  source?: unknown;
  license?: unknown;
  mood?: unknown;
  bpm?: unknown;
  description?: unknown;
}

/**
 * Load + validate the music manifest, keeping only tracks whose audio file actually exists on disk.
 * Returns [] for a missing/empty/invalid library so the scoring stage can safely no-op.
 */
export function loadMusicLibrary(dir: string = MUSIC_DIR): Track[] {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return [];
  }
  const rawTracks = (parsed as { tracks?: unknown })?.tracks;
  if (!Array.isArray(rawTracks)) return [];

  const out: Track[] = [];
  for (const r of rawTracks as RawTrack[]) {
    if (typeof r?.id !== "string" || typeof r?.file !== "string") continue;
    const abs = join(dir, r.file);
    if (!existsSync(abs)) continue;
    out.push({
      id: r.id,
      file: r.file,
      title: typeof r.title === "string" ? r.title : undefined,
      source: typeof r.source === "string" ? r.source : undefined,
      license: typeof r.license === "string" ? r.license : undefined,
      mood: Array.isArray(r.mood) ? r.mood.filter((m): m is string => typeof m === "string") : undefined,
      bpm: typeof r.bpm === "number" ? r.bpm : null,
      description: typeof r.description === "string" ? r.description : undefined,
      path: abs,
    });
  }
  return out;
}

/** Prefer a neutral bed (minimal/calm) as the safe default; else the first track. */
export function pickDefaultTrack(library: Track[]): Track | undefined {
  if (library.length === 0) return undefined;
  const neutral = library.find((t) => t.mood?.some((m) => m === "minimal" || m === "calm"));
  return neutral ?? library[0];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function transcriptExcerpt(words: Word[], max = 900): string {
  const text = words.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const MUSIC_SYSTEM = `You are the music director for a short-form vertical talking-head marketing video.
Pick ONE background music track from the provided library that best fits the video's tone. The music is a
GENTLE, UNOBTRUSIVE bed mixed quietly UNDER the speaker's voice — never a hype track. Favor calm/minimal
unless the script is clearly upbeat or celebratory. Also choose mix levels.
The tracks are already balanced to sit under the voice, so keep the gain a SMALL trim near 0 (never a
big negative value — that makes the music inaudible). Return ONLY JSON:
{
  "trackId": "<one id from the library>",
  "musicGainDb": number,   // small trim, -8..+2 (0 = balanced bed, clearly audible; negative = quieter)
  "duckAmountDb": number,  // how much the music dips while speaking, 4..9
  "fadeInMs": number,      // 500..3000
  "fadeOutMs": number,     // 1000..4000
  "rationale": "one short sentence"
}`;

export function buildMusicMessages(
  library: Track[],
  brief: RenderBrief,
  words: Word[],
): { role: "system" | "user"; content: string }[] {
  const catalog = library.map((t) => ({
    id: t.id,
    title: t.title,
    mood: t.mood,
    description: t.description,
  }));
  const payload = {
    library: catalog,
    brandVoice: brief.assets?.brandVoice ?? null,
    accentColor: brief.accentColor ?? null,
    transcript: transcriptExcerpt(words),
  };
  return [
    { role: "system", content: MUSIC_SYSTEM },
    { role: "user", content: `Choose music for this video:\n${JSON.stringify(payload)}` },
  ];
}

/** Parse + validate the model's choice against the library. Returns null on any problem. */
export function parseMusicChoice(
  content: string | null | undefined,
  validIds: Set<string>,
): { trackId: string; mix: MixParams } | null {
  if (!content) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const trackId = obj.trackId;
  if (typeof trackId !== "string" || !validIds.has(trackId)) return null;
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    trackId,
    mix: {
      musicGainDb: clamp(num(obj.musicGainDb, DEFAULT_MIX.musicGainDb), -12, 3),
      duckAmountDb: clamp(num(obj.duckAmountDb, DEFAULT_MIX.duckAmountDb), 3, 10),
      fadeInMs: clamp(num(obj.fadeInMs, DEFAULT_MIX.fadeInMs), 0, 4000),
      fadeOutMs: clamp(num(obj.fadeOutMs, DEFAULT_MIX.fadeOutMs), 0, 6000),
    },
  };
}

/**
 * The "music director" call. Picks a track + mix levels from the library; on ANY failure (no API key,
 * timeout, malformed output, unknown id) falls back to a deterministic neutral default. Never throws.
 */
export async function selectTrack(
  library: Track[],
  brief: RenderBrief,
  words: Word[],
  log: (m: string) => void = () => {},
): Promise<{ track: Track; mix: MixParams }> {
  const fallback = pickDefaultTrack(library)!; // caller guarantees non-empty
  try {
    const client = getOpenAI();
    const resp = await client.chat.completions.create(
      {
        model: MUSIC_MODEL,
        ...chatTuning(MUSIC_MODEL, MUSIC_EFFORT),
        response_format: { type: "json_object" },
        messages: buildMusicMessages(library, brief, words),
      },
      premiumRequestOptions(),
    );
    const validIds = new Set(library.map((t) => t.id));
    const choice = parseMusicChoice(resp.choices[0]?.message?.content, validIds);
    if (!choice) {
      log(`music director returned no usable choice; using default "${fallback.id}"`);
      return { track: fallback, mix: DEFAULT_MIX };
    }
    const track = library.find((t) => t.id === choice.trackId) ?? fallback;
    return { track, mix: choice.mix };
  } catch (e) {
    log(`music director failed (${(e as Error).message}); using default "${fallback.id}"`);
    return { track: fallback, mix: DEFAULT_MIX };
  }
}

export interface SoundtrackArgs {
  videoPath: string;
  brief: RenderBrief;
  words: Word[];
  log?: (m: string) => void;
  /** Override the library directory (tests). */
  musicDir?: string;
}

/**
 * Post-edit "sound-tracking" stage: pick a gentle track and mix it, ducked, under the voice, then
 * replace `videoPath` in place. Best-effort by design — disabled flag, empty library, a video with no
 * audio, or any ffmpeg/selection error leaves the video untouched so a render can never break here.
 */
export async function soundtrack(args: SoundtrackArgs): Promise<void> {
  const { videoPath, brief, words } = args;
  const log = args.log ?? (() => {});

  if (process.env.RENDER_MUSIC === "0") {
    log("music disabled (RENDER_MUSIC=0); skipping");
    return;
  }

  const library = loadMusicLibrary(args.musicDir);
  if (library.length === 0) {
    log("no music tracks available; skipping");
    return;
  }

  const scoredPath = `${videoPath}.scored.mp4`;
  try {
    if (!(await hasAudioStream(videoPath))) {
      log("video has no audio stream; skipping music");
      return;
    }
    const { track, mix } = await selectTrack(library, brief, words, log);
    const { durationMs } = await probeVideo(videoPath);
    await mixMusicUnderVoice(videoPath, track.path, scoredPath, {
      musicGainDb: mix.musicGainDb,
      duckAmountDb: mix.duckAmountDb,
      fadeInMs: mix.fadeInMs,
      fadeOutMs: mix.fadeOutMs,
      videoDurationMs: durationMs,
    });
    await rename(scoredPath, videoPath);
    log(`scored with "${track.id}" (bed ${mix.musicGainDb}dB, duck ${mix.duckAmountDb}dB)`);
  } catch (e) {
    log(`scoring failed (${(e as Error).message}); shipping video without music`);
    await rm(scoredPath, { force: true });
  }
}
