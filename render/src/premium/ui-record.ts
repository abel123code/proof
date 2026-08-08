/**
 * The verbatim text extracted from a screenshot at upload time (see src/lib/ui-record.ts on the
 * web side). Structurally identical, duplicated rather than shared because the worker is a separate
 * package with no import path into the Next app.
 */
export interface UiTextItem {
  text: string;
  region: string;
  legible: boolean;
}

export interface UiRecord {
  items: UiTextItem[];
}

/** Keyed by the filename the asset is staged under, the same key assetDescriptions uses. */
export type UiRecords = Record<string, UiRecord>;

/**
 * The strings a scene may render for one image: the legible ones, and nothing else.
 *
 * Illegible items are deliberately dropped rather than passed along. They exist so the extractor
 * can say "there is text here I could not read", which tells the author to omit that row or show
 * it as a blank bar. Handing the model its uncertain reading would invite it to tidy it up.
 */
export function legibleText(record: UiRecord | undefined): string[] {
  return (record?.items ?? []).filter((item) => item.legible).map((item) => item.text);
}
