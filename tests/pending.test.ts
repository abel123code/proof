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

/**
 * Source-level, deliberately: there is no component testing library in this repo, and
 * adding one to assert a two-branch callback is not worth the dependency. What this pins
 * is the property an adversarial review caught, so a later tidy-up cannot quietly undo it.
 */
describe("sign-out failure handling", () => {
  const actions = readFileSync("src/components/pending-actions.tsx", "utf8").replace(/\s+/g, " ");

  it("inspects the returned error rather than only catching throws", () => {
    // supabase.auth.signOut() RESOLVES with { error } for ordinary failures. A bare
    // try/catch around it reports success for a sign-out that did nothing, leaving a live
    // session behind a page that claims you are signed out.
    expect(actions).toMatch(/const \{ error \} = await supabase\.auth\.signOut\(\)/);
    expect(actions).toContain("if (error) throw error");
  });

  it("confirms the session is gone before showing the login page", () => {
    expect(actions).toContain("getSession()");
    expect(actions).toMatch(/if \(data\.session\) throw/);
  });

  it("surfaces a retryable message instead of navigating away on failure", () => {
    expect(actions).toContain("signOutError");
    expect(actions).toContain('role="alert"');
    // The failure path must return, never fall through to the redirect.
    expect(actions).toMatch(/setSigningOut\(false\); return;/);
  });
});
