/**
 * The accent used when a brief carries no brand colour.
 *
 * This was `#d9ff45`, an acid lime, duplicated across three call sites. It is a strong opinion to
 * impose on someone who never chose it: a video for a product with a dark blue interface came back
 * with lime highlights, and nobody had asked for that.
 *
 * A default is worn by every user who has not set a colour, so it should read as neutral-but-alive
 * rather than as a brand. This blue holds contrast over both dark and bright footage, reads as UI
 * rather than as decoration, and is close enough to the blue most product interfaces already use
 * that it rarely fights the screenshots it sits beside.
 *
 * The real fix is to stop guessing: derive the accent from the brand assets the brief already
 * carries, or from the repo's own CSS. Until then this is one constant instead of three literals.
 */
export const DEFAULT_ACCENT = "#4da3ff";
