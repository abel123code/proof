/**
 * Deterministic asset-inclusion gate. The #1 pass-rate failure (e2e 2026-07-15) is the author
 * naming a provided logo/screenshot in prose but rendering a generic icon instead of embedding the
 * real file. QA catches it, but only after a wasted render + vision call. This gate runs on the
 * authored HTML BEFORE rendering: if the scene's intent names specific assets, the HTML must
 * actually reference them — otherwise we re-author with targeted feedback for free.
 */

/**
 * Asset filenames the intent explicitly calls out to EMBED — i.e. referenced as a path
 * (`assets/<file>` / `./assets/<file>`), the way a scene's brollCue names the shot to feature.
 * Deliberately does NOT match a bare filename mention (e.g. an "available assets: a.png, b.png"
 * list), so the gate only requires the specific assets a beat is built around, not every asset.
 */
export function assetsNamedInIntent(intent: string, assetHints: string[]): string[] {
  const hay = intent.toLowerCase();
  return assetHints.filter((name) => hay.includes("assets/" + name.toLowerCase()));
}

/**
 * Of the required asset filenames, those NOT embedded via an actual `assets/<name>` path reference
 * in the HTML (case-insensitive). Requiring the path — not a bare filename mention — means a comment
 * (`<!-- logo.png -->`) or stray text can no longer satisfy the gate; only a real `src="./assets/…"`
 * (or `url(assets/…)`) counts.
 */
export function missingAssets(html: string, required: string[]): string[] {
  const hay = html.toLowerCase();
  return required.filter((name) => !hay.includes("assets/" + name.toLowerCase()));
}
