/**
 * Deterministic asset-inclusion gate. The #1 pass-rate failure (e2e 2026-07-15) is the author
 * naming a provided logo/screenshot in prose but rendering a generic icon instead of embedding the
 * real file. QA catches it, but only after a wasted render + vision call. This gate runs on the
 * authored HTML BEFORE rendering: if the scene's intent names specific assets, the HTML must
 * actually reference them — otherwise we re-author with targeted feedback for free.
 */

/** Asset filenames (from the provided hints) that the intent text explicitly calls out. */
export function assetsNamedInIntent(intent: string, assetHints: string[]): string[] {
  const hay = intent.toLowerCase();
  return assetHints.filter((name) => hay.includes(name.toLowerCase()));
}

/** Of the required asset filenames, those NOT referenced anywhere in the HTML (case-insensitive). */
export function missingAssets(html: string, required: string[]): string[] {
  const hay = html.toLowerCase();
  return required.filter((name) => !hay.includes(name.toLowerCase()));
}
