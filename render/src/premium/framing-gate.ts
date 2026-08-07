import { parse, HTMLElement } from "node-html-parser";

/**
 * Deterministic image-framing gate. Real production QA repeatedly flagged the same defect: a wide
 * desktop screenshot (e.g. 2756x1550) embedded whole into a 1080x1920 frame — a label clipped at
 * the edge ("imension" instead of "eDimension"), a popup too small to read at essential-text size.
 * The author is told what each asset depicts and where its important content sits (see scenes.ts's
 * buildSceneIntent / author.ts's assets payload), but nothing enforced that it actually crop to that
 * region instead of shrinking the whole capture in. This gate runs on the authored HTML BEFORE
 * rendering: if a staged asset image has neither a scale/transform, nor a positioned wrapper with
 * overflow:hidden, nor an explicit object-fit crop, re-author with targeted feedback for free
 * instead of paying for a render and a vision call to discover the screenshot was placed whole.
 *
 * This used to be a regex scan over a TEXT WINDOW from the previous asset image to the current tag.
 * Two bypasses fell out of that: (1) author.ts's HARD CONTRACT requires the root #stage to carry
 * `style="position:relative;...;overflow:hidden"` INLINE — so the window for the first image in
 * every scene always contained a positioned, overflow:hidden ancestor, satisfying the "crop wrapper"
 * check with zero cropping. The gate only ever rejected real scenes because the live author happened
 * to put stage styling in a <style> block instead of inline; the moment it followed its own contract,
 * the gate went blind. (2) any `transform: scale(...)` counted, including scale(0.2), which SHRINKS
 * the interface text the crop exists to make readable.
 *
 * The fix: parse the HTML for real and walk each asset <img>'s actual ancestor chain, excluding
 * #stage explicitly (it is mandatory on every scene and says nothing about whether THIS image was
 * cropped), and only accept a scale that enlarges (> 1).
 */

export interface FramingCheck {
  ok: boolean;
  reason?: string;
}

// The mandatory stage geometry (author.ts's HARD CONTRACT, item 1). A non-stage wrapper sized to
// exactly this is the stage's own geometry wearing a different tag, not a crop window.
const STAGE_WIDTH = 1080;
const STAGE_HEIGHT = 1920;

const ASSET_SRC = /assets\//i;

/** Parse a `style="a:b;c:d"` attribute into a lowercase-keyed property map. */
function parseStyle(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style) return out;
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (prop) out[prop] = value;
  }
  return out;
}

/** First numeric px value in a CSS length (e.g. "900px" -> 900). Null if absent/non-px. */
function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.match(/(-?\d+(?:\.\d+)?)\s*px/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * True if this element's own width/height (style OR HTML attribute) constrains it to something
 * smaller than the full 1080x1920 stage — a real crop window, not the stage's own geometry.
 */
function hasConstrainedSize(el: HTMLElement, style: Record<string, string>): boolean {
  const w = parsePx(style.width) ?? numericAttr(el.getAttribute("width"));
  const h = parsePx(style.height) ?? numericAttr(el.getAttribute("height"));
  const widthConstrained = w != null && w !== STAGE_WIDTH;
  const heightConstrained = h != null && h !== STAGE_HEIGHT;
  return widthConstrained || heightConstrained;
}

function numericAttr(value: string | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** True if this element declares ANY explicit numeric width/height (style or attribute). */
function hasExplicitDimension(el: HTMLElement, style: Record<string, string>): boolean {
  if (/\d/.test(style.width || "") || /\d/.test(style.height || "")) return true;
  return numericAttr(el.getAttribute("width")) != null || numericAttr(el.getAttribute("height")) != null;
}

/**
 * True if `style` carries a `transform: scale(...)` (or scaleX/scaleY) that ENLARGES — a factor
 * strictly greater than 1. `scale(0.2)` shrinks (bypass 2) and `scale(1)` is a no-op; neither is
 * crop intent. `scale(x, y)` counts if either axis enlarges.
 */
function hasEnlargingScale(style: Record<string, string>): boolean {
  const transform = style.transform;
  if (!transform) return false;
  const re = /scale[xy]?\s*\(\s*(-?\d*\.?\d+)\s*(?:,\s*(-?\d*\.?\d+)\s*)?\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(transform))) {
    const a = parseFloat(m[1]);
    const b = m[2] !== undefined ? parseFloat(m[2]) : a;
    if (a > 1 || b > 1) return true;
  }
  return false;
}

/**
 * True if `style` is a genuine crop window: overflow:hidden AND a position, AND a size constrained
 * below the full 1080x1920 stage. Overflow:hidden + position alone isn't enough — the mandatory
 * #stage itself has both (see module comment); size is what tells a crop wrapper apart from a
 * differently-tagged copy of the stage's own geometry.
 */
function isCropWrapper(el: HTMLElement, style: Record<string, string>): boolean {
  const overflowHidden = /hidden/i.test(style.overflow || "");
  const positioned = /^(relative|absolute|fixed|sticky)$/i.test((style.position || "").trim());
  return overflowHidden && positioned && hasConstrainedSize(el, style);
}

/**
 * True if `style` is an object-fit crop: `object-fit: cover` or `contain` paired with an explicit
 * width/height ON THE IMAGE — object-fit alone, with no box to constrain it, crops nothing.
 */
function isObjectFitCrop(el: HTMLElement, style: Record<string, string>): boolean {
  return /^(cover|contain)$/i.test((style["object-fit"] || "").trim()) && hasExplicitDimension(el, style);
}

/**
 * Decide crop intent from an asset <img>'s REAL ancestor chain (styles are inline in this pipeline —
 * the author contract instructs the model to write inline styles — so reading the `style` attribute
 * off each ancestor is correct. A <style> BLOCK carrying the crop instead is out of scope: this walk
 * only sees inline styles, so a scene that puts its crop wrapper's rules in a <style> block will be
 * judged as uncropped even if it visually crops. That's a known, deliberate limitation, not a bug).
 */
function hasCropIntent(img: HTMLElement): boolean {
  const imgStyle = parseStyle(img.getAttribute("style"));
  if (hasEnlargingScale(imgStyle)) return true;
  if (isObjectFitCrop(img, imgStyle)) return true;

  let node: HTMLElement | null | undefined = img.parentNode;
  while (node) {
    // #stage is the mandatory 1080x1920 root — every scene has it, so it says nothing about
    // whether THIS image was cropped. This is bypass 1: never let it count as crop evidence.
    if (node.id !== "stage") {
      const style = parseStyle(node.getAttribute("style"));
      if (hasEnlargingScale(style)) return true;
      if (isCropWrapper(node, style)) return true;
    }
    node = node.parentNode;
  }
  return false;
}

export function checkImageFraming(html: string): FramingCheck {
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    // Unparseable HTML isn't this gate's job to reject (sanitize.ts's validator owns that trust
    // boundary) — nothing to judge, so don't block on a parse failure here.
    return { ok: true };
  }

  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (!ASSET_SRC.test(src)) continue;
    const file = src.split(/assets\//i).pop() || src;

    if (!hasCropIntent(img)) {
      return {
        ok: false,
        reason:
          `MUST FIX: ./assets/${file} is placed with no cropping or scaling intent — a wide screenshot ` +
          `dropped in whole leaves interface text unreadable and risks clipping a label at the frame edge. ` +
          `Crop to the region the asset's description names as important: wrap it in a positioned container ` +
          `with overflow:hidden and scale/position the <img> inside it, or apply object-fit:cover with ` +
          `explicit width/height — never place the raw capture at full size.`,
      };
    }
  }
  return { ok: true };
}
