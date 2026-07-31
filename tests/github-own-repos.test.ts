import { describe, expect, it, beforeAll } from "vitest";
import { canAnalyseRepo } from "@/lib/github-app";

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
});

describe("canAnalyseRepo — you analyse your own work", () => {
  it("allows a repo owned by the user's saved handle", () => {
    expect(canAnalyseRepo({ owner: "AbhishekVulla", profileHandle: "abhishekvulla" })).toBe(true);
    expect(canAnalyseRepo({ owner: "abhishekvulla", profileHandle: "  AbhishekVulla  " })).toBe(true);
  });

  it("refuses somebody else's repo", () => {
    // Two reasons this matters: Proof's premise is "prove YOU built it", and the picker runs on one
    // shared server token, so an open handle field lets one user exhaust the rate limit for all.
    expect(canAnalyseRepo({ owner: "torvalds", profileHandle: "abhishekvulla" })).toBe(false);
    expect(canAnalyseRepo({ owner: "vercel", profileHandle: "abhishekvulla" })).toBe(false);
  });

  it("refuses when no handle is saved, rather than defaulting open", () => {
    expect(canAnalyseRepo({ owner: "anyone", profileHandle: null })).toBe(false);
    expect(canAnalyseRepo({ owner: "anyone", profileHandle: "   " })).toBe(false);
  });

  it("allows a repo the user granted through their own installation", () => {
    // Covers org-owned and collaborator repos: the user proved access via GitHub itself, and the
    // owner login legitimately differs from their personal handle.
    expect(
      canAnalyseRepo({
        owner: "some-org",
        profileHandle: "abhishekvulla",
        grantedByInstallation: true,
      }),
    ).toBe(true);
  });

  it("does not let an installation grant override a missing handle by accident", () => {
    // grantedByInstallation must come from a real installationCanAccess() check, and when it is
    // false the handle rule still applies.
    expect(
      canAnalyseRepo({ owner: "some-org", profileHandle: null, grantedByInstallation: false }),
    ).toBe(false);
  });
});
