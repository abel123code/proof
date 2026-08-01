import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pendingCopy, resolvePendingStatus, resolveUserCap } from "@/lib/pending";

describe("resolveUserCap", () => {
  it("defaults to 50 when unset or unparseable", () => {
    for (const raw of [undefined, "", "abc", "0", "-5", "NaN"]) {
      expect(resolveUserCap(raw)).toBe(50);
    }
  });

  it("honours a bigger cohort without a deploy", () => {
    expect(resolveUserCap("120")).toBe(120);
    expect(resolveUserCap("7.9")).toBe(7);
  });
});

describe("resolvePendingStatus", () => {
  it("treats only an explicit full as full", () => {
    expect(resolvePendingStatus("full")).toBe("full");
  });

  it("falls back to pending for anything else, including junk", () => {
    for (const raw of [null, undefined, "", "pending", "FULL", "<script>", "active"]) {
      expect(resolvePendingStatus(raw)).toBe("pending");
    }
  });
});

describe("pendingCopy", () => {
  it("tells a waitlisted user to come back, not to wait for an email", () => {
    const copy = pendingCopy("pending", 50);
    expect(copy.body).toMatch(/refresh this page/i);
    // The old copy promised an email. There is no email provider in this repo, so that
    // promise could never be kept and must not reappear.
    expect(copy.body).not.toMatch(/email/i);
  });

  it("says something different when the cap is the blocker, and names the real cap", () => {
    const full = pendingCopy("full", 120);
    const pending = pendingCopy("pending", 120);

    expect(full.title).not.toBe(pending.title);
    expect(full.body).toContain("120");
    expect(full.body).not.toMatch(/email/i);
  });

  it("never hardcodes 50 in the copy", () => {
    expect(pendingCopy("full", 200).body).not.toContain("50");
  });
});

describe("the pending page itself", () => {
  const page = readFileSync("src/app/pending/page.tsx", "utf8").replace(/\s+/g, " ");

  it("re-checks approval on load so an approved user is never stranded", () => {
    // The trap: ensureProfile only ran in the OAuth callback, so a user approved AFTER
    // signing in stayed on /pending forever, however many times they came back.
    expect(page).toContain("ensureProfile");
    expect(page).toMatch(/redirect\(/);
  });

  it("offers a way out, since sign-out otherwise only exists behind the approval gate", () => {
    expect(page).toContain("PendingActions");
  });
});
