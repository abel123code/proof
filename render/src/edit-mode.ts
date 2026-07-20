import type { EditMode, RenderJobInput } from "./types.js";

const EDIT_MODES = new Set<EditMode>([
  "brief-driven",
  "classic",
  "generated-experimental",
]);

/** Keep render mode under worker configuration, not caller control. */
export function resolveWorkerEditMode(raw: string | undefined): EditMode {
  const mode = raw?.trim() || "generated-experimental";
  if (EDIT_MODES.has(mode as EditMode)) return mode as EditMode;
  throw new Error(`Invalid RENDER_EDIT_MODE: ${mode}`);
}

export function enforceWorkerEditMode(
  input: RenderJobInput,
  mode: EditMode,
): RenderJobInput {
  return { ...input, editMode: mode };
}
