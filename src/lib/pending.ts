/**
 * Copy and config for the waitlist page.
 *
 * Split out from the page so the decisions are unit-testable without rendering React,
 * and so the "we'll email you" promise can never quietly come back: there is no email
 * provider in this codebase, so the page must tell people to come back and refresh
 * instead. `/pending` re-runs `ensureProfile` on every load, which is what makes that
 * instruction true rather than a brush-off.
 */

/** Early-access ceiling. Env-overridable so a bigger cohort doesn't need a deploy. */
export function resolveUserCap(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

export type PendingStatus = "pending" | "full";

/** Only "full" is distinguishable; anything else (including junk) reads as pending. */
export function resolvePendingStatus(raw: string | null | undefined): PendingStatus {
  return raw === "full" ? "full" : "pending";
}

export interface PendingCopy {
  title: string;
  body: string;
}

export function pendingCopy(status: PendingStatus, cap: number): PendingCopy {
  if (status === "full") {
    return {
      title: "Early access is full",
      body:
        `Proof is capped at ${cap} builders while we're in early access, and every spot is ` +
        `taken right now. You're on the list. Come back and refresh this page, it will let ` +
        `you straight in as soon as one frees up.`,
    };
  }
  return {
    title: "You're on the list",
    body:
      "Proof is invite-only while we're in early access and your account is waiting to be " +
      "approved. Come back and refresh this page any time. The moment you're approved it " +
      "will let you straight through, you don't need to wait to hear from us.",
  };
}
