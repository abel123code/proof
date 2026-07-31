// Client-only labels for scene footage, keyed by brief. Supabase stores every clip at a
// deterministic path (scene-N.ext), so the file the creator actually picked, the thing
// that tells "which of my ten recordings is this?", is otherwise lost the moment it
// uploads. We stash the original filename (or a "Recorded take" label) in localStorage so
// the studio can show it per scene and it survives a reload in the same browser, WITHOUT a
// DB migration. The clip's playable preview is already DB-backed (the footage URL); this
// only adds the human-readable label on top.

const PREFIX = "proof.footageNames.";

export type FootageNames = Record<number, string>;

function keyFor(briefId: string): string {
  return `${PREFIX}${briefId}`;
}

/** All footage labels for a brief, mapped sceneIndex -> filename/label. */
export function readFootageNames(briefId: string | null): FootageNames {
  if (!briefId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(keyFor(briefId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: FootageNames = {};
    for (const [k, v] of Object.entries(parsed)) {
      const i = Number(k);
      if (!Number.isNaN(i) && typeof v === "string") out[i] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(briefId: string, names: FootageNames): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(names).length === 0) window.localStorage.removeItem(keyFor(briefId));
    else window.localStorage.setItem(keyFor(briefId), JSON.stringify(names));
  } catch {
 // Ignore quota / privacy-mode failures, the label is a nicety, not load-bearing.
  }
}

/** Remember a scene's footage label. Returns the updated map so callers can sync state. */
export function setFootageName(
  briefId: string | null,
  sceneIndex: number,
  name: string,
): FootageNames {
  if (!briefId) return {};
  const next = { ...readFootageNames(briefId), [sceneIndex]: name };
  persist(briefId, next);
  return next;
}

/** Forget a scene's footage label (on delete). Returns the updated map. */
export function removeFootageName(briefId: string | null, sceneIndex: number): FootageNames {
  if (!briefId) return {};
  const next = readFootageNames(briefId);
  delete next[sceneIndex];
  persist(briefId, next);
  return next;
}
