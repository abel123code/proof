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
 */

export interface FramingCheck {
  ok: boolean;
  reason?: string;
}

// Matches self-contained `<img ...>` tags. Pragmatic regex parse over the HTML string, not a
// CSS/DOM engine — like motion-gate's tween match, this is a heuristic guard, not a layout simulator.
const IMG_TAG = /<img\b[^>]*>/gi;

// The asset path convention every scene uses (mirrors assets-gate.ts's "assets/<file>" check).
// Captures the full attribute value so the offending filename can be named in the reason.
const ASSET_SRC = /src\s*=\s*["']([^"']*assets\/[^"']+)["']/i;

const HAS_SCALE = /transform\s*:[^;"']*scale\s*\(/i;
const HAS_OVERFLOW_HIDDEN = /overflow\s*:\s*hidden/i;
const HAS_POSITIONED = /position\s*:\s*(?:relative|absolute|fixed|sticky)/i;
const HAS_OBJECT_FIT_CROP = /object-fit\s*:\s*(?:cover|contain)/i;
const HAS_EXPLICIT_DIMENSION = /\b(?:width|height)\s*[:=]\s*["']?\d/i;

/**
 * True if `context` — the HTML from the previous asset image (or the top of the document) through
 * this image's own tag — shows cropping/scaling intent: a scale transform, a positioned wrapper with
 * overflow:hidden (a crop window), or an explicit object-fit crop paired with real dimensions (an
 * object-fit alone, with no box to constrain it, crops nothing). No real DOM is built, so "context"
 * is an approximation of "this image and the wrapper it sits in" — close enough for a pre-render
 * heuristic without pulling in an unrelated, already-closed wrapper from earlier in the document.
 */
function hasCropIntent(context: string): boolean {
  const scaled = HAS_SCALE.test(context);
  const croppedWrapper = HAS_OVERFLOW_HIDDEN.test(context) && HAS_POSITIONED.test(context);
  const objectFitCrop = HAS_OBJECT_FIT_CROP.test(context) && HAS_EXPLICIT_DIMENSION.test(context);
  return scaled || croppedWrapper || objectFitCrop;
}

export function checkImageFraming(html: string): FramingCheck {
  let cursor = 0;
  for (const match of html.matchAll(IMG_TAG)) {
    const tag = match[0];
    const start = match.index ?? 0;
    const end = start + tag.length;
    const src = tag.match(ASSET_SRC);
    if (!src) {
      cursor = end;
      continue;
    }
    const file = src[1].split(/assets\//i).pop() || src[1];
    const context = html.slice(cursor, end);
    cursor = end;

    if (!hasCropIntent(context)) {
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
