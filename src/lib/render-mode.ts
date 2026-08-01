export type RenderEditMode =
  | "brief-driven"
  | "classic"
  | "generated-experimental";

const RENDER_EDIT_MODES = new Set<RenderEditMode>([
  "brief-driven",
  "classic",
  "generated-experimental",
]);

export function resolveRenderMode(value: string | undefined): RenderEditMode {
  const mode = value?.trim() || "generated-experimental";
  if (RENDER_EDIT_MODES.has(mode as RenderEditMode)) {
    return mode as RenderEditMode;
  }
  throw new Error(`Invalid RENDER_EDIT_MODE: ${mode}`);
}
