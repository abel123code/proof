import { overlayScenesAtOffsets } from "../ffmpeg.js";
import type { AuthoredScene } from "../types.js";

/**
 * Composite the rendered bespoke scenes onto the (already-captioned) base clip, each at its
 * anchor. Scenes without a rendered MOV (author/render/QA gave up) are skipped — the base
 * simply shows through for that beat, so a single bad scene never sinks the whole render.
 */
export async function composeScenes(
  basePath: string,
  scenes: AuthoredScene[],
  outPath: string,
): Promise<number> {
  const windows = scenes
    .filter((s): s is AuthoredScene & { movPath: string } => Boolean(s.movPath))
    .map((s) => ({
      movPath: s.movPath,
      startMs: s.spec.anchorMs,
      endMs: s.spec.anchorMs + s.spec.durMs,
    }));

  if (windows.length === 0) throw new Error("composeScenes: no rendered scenes to composite");
  await overlayScenesAtOffsets(basePath, windows, outPath);
  return windows.length;
}
