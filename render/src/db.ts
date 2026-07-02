// DB access for the render half. Only the tables this service touches:
// captures (read) -> scripts (read) -> transcripts (write) -> renders (write).
import { getSupabaseAdmin } from "./supabase.js";
import type { KeywordFlag, RenderBrief, WhisperWord } from "./types.js";

export interface CaptureWithScript {
  captureId: string;
  videoUrl: string;
  brief: RenderBrief;
}

/** Load a capture's recording URL + its script/keyword-flags, assembled into a RenderBrief. */
export async function getCaptureWithScript(captureId: string): Promise<CaptureWithScript> {
  const supabase = getSupabaseAdmin();

  const { data: capture, error: capErr } = await supabase
    .from("captures")
    .select("id, script_id, video_url")
    .eq("id", captureId)
    .single();
  if (capErr) throw new Error(`getCapture failed: ${capErr.message}`);
  if (!capture.video_url) throw new Error(`capture ${captureId} has no video_url`);

  const { data: script, error: scrErr } = await supabase
    .from("scripts")
    .select("content, keyword_flags")
    .eq("id", capture.script_id)
    .single();
  if (scrErr) throw new Error(`getScript failed: ${scrErr.message}`);

  return {
    captureId: capture.id,
    videoUrl: capture.video_url,
    brief: {
      script: script.content ?? "",
      keywordFlags: (script.keyword_flags as KeywordFlag[] | null) ?? [],
    },
  };
}

/** Persist word-level transcript; returns the new transcript id. */
export async function createTranscript(
  captureId: string,
  words: WhisperWord[],
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("transcripts")
    .insert({ capture_id: captureId, words })
    .select("id")
    .single();
  if (error) throw new Error(`createTranscript failed: ${error.message}`);
  return data.id as string;
}

/** Open a render row in 'rendering' state; returns the new render id. */
export async function createRender(transcriptId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("renders")
    .insert({ transcript_id: transcriptId, status: "rendering" })
    .select("id")
    .single();
  if (error) throw new Error(`createRender failed: ${error.message}`);
  return data.id as string;
}

export async function updateRender(
  renderId: string,
  patch: { status?: string; mp4Url?: string },
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.mp4Url !== undefined) row.mp4_url = patch.mp4Url;
  const { error } = await supabase.from("renders").update(row).eq("id", renderId);
  if (error) throw new Error(`updateRender failed: ${error.message}`);
}
