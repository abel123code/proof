// Tiny pub/sub so any charged action can tell the header to re-fetch the credit
// balance. The header owns the fetch (/api/profile is the source of truth); call
// sites just fire a signal after a request that may have charged or refunded.

const CREDITS_CHANGED = "credits:changed";

/** Fire after any request that may have moved the balance (charge or refund). */
export function emitCreditsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CREDITS_CHANGED));
}

/** Subscribe to balance-change signals. Returns an unsubscribe fn. */
export function onCreditsChanged(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CREDITS_CHANGED, cb);
  return () => window.removeEventListener(CREDITS_CHANGED, cb);
}
