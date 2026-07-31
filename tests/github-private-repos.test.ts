import { describe, expect, it, beforeAll } from "vitest";

import { isAccessError } from "@/lib/github";
import { mergeRepoLists } from "@/app/api/github/repos/route";

// signState/verifyState sign with the service-role key; provide one for the test process.
beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
});

describe("isAccessError — the 404-is-really-403 trap", () => {
  it("treats 401/403/404 as access failures, not 'missing README'", () => {
    // GitHub returns 404 (NOT 403) for private resources the caller cannot see. Swallowing that as
    // "no README" made the pipeline script a video about an empty repo.
    expect(isAccessError({ status: 404 })).toBe(true);
    expect(isAccessError({ status: 403 })).toBe(true);
    expect(isAccessError({ status: 401 })).toBe(true);
  });

  it("does not misclassify unrelated failures", () => {
    expect(isAccessError({ status: 500 })).toBe(false);
    expect(isAccessError({ status: 422 })).toBe(false);
    expect(isAccessError(new Error("network down"))).toBe(false);
    expect(isAccessError(undefined)).toBe(false);
  });
});

describe('fetchRepoSnapshot access handling', () => {
  it('throws an actionable error when the REPO itself is invisible', async () => {
    const { fetchRepoSnapshot } = await import('@/lib/github');
    const notFound = Object.assign(new Error('Not Found'), { status: 404 });
    const gh = { repos: { get: async () => { throw notFound; } } };
    await expect(
      fetchRepoSnapshot('https://github.com/me/secret', gh as never),
    ).rejects.toThrow(/connect it to Proof/);
  });

  it('still degrades gracefully when the repo is visible but has NO README', async () => {
    // Regression: GitHub returns 404 for a repo with no README too. Treating that as an access
    // failure broke every public repo without a README.
    const { fetchRepoSnapshot } = await import('@/lib/github');
    const notFound = Object.assign(new Error('Not Found'), { status: 404 });
    const gh = {
      repos: {
        get: async () => ({ data: { name: 'r', description: null, default_branch: 'main' } }),
        listLanguages: async () => ({ data: { TypeScript: 1 } }),
        getReadme: async () => { throw notFound; },
      },
      git: { getTree: async () => ({ data: { tree: [] } }) },
    };
    const snap = await fetchRepoSnapshot('https://github.com/me/public-no-readme', gh as never);
    expect(snap.readme).toBe('(no README found)');
    expect(snap.name).toBe('r');
  });
});

describe("mergeRepoLists", () => {
  const pub = (fullName: string, pushedAt: string) => ({
    name: fullName.split("/")[1],
    fullName,
    url: `https://github.com/${fullName}`,
    description: null,
    language: null,
    stars: 0,
    pushedAt,
  });

  it("marks private repos and sorts everything newest-first", () => {
    const merged = mergeRepoLists(
      [pub("me/old-public", "2026-01-01T00:00:00Z")],
      [{ ...pub("me/secret", "2026-07-01T00:00:00Z"), isPrivate: true as const }],
    );
    expect(merged.map((r) => r.fullName)).toEqual(["me/secret", "me/old-public"]);
    expect(merged[0].isPrivate).toBe(true);
    expect(merged[1].isPrivate).toBe(false);
  });

  it("de-duplicates, letting the installation copy win so the badge stays honest", () => {
    const merged = mergeRepoLists(
      [pub("Me/Repo", "2026-01-01T00:00:00Z")],
      [{ ...pub("me/repo", "2026-01-01T00:00:00Z"), isPrivate: true as const }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].isPrivate).toBe(true);
  });

  it("is a no-op when nothing is connected", () => {
    const merged = mergeRepoLists([pub("me/a", "2026-01-01T00:00:00Z")], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].isPrivate).toBe(false);
  });
});

describe("install state (CSRF on the GitHub callback)", () => {
  it("round-trips the user id and rejects tampering, other users' states, and expiry", async () => {
    const { signState, verifyState } = await import("@/lib/github-app");
    const now = Date.now();
    const state = signState("user-abc", now);

    expect(verifyState(state, now)).toBe("user-abc");

    // Tampered payload: swapping the user id must not verify, or an attacker could bind their
    // installation to someone else's account.
    const forged = state.replace("user-abc", "user-xyz");
    expect(verifyState(forged, now)).toBeNull();

    // Expired (>15 min) and malformed states are rejected.
    expect(verifyState(state, now + 16 * 60 * 1000)).toBeNull();
    expect(verifyState("garbage", now)).toBeNull();
    expect(verifyState("a.b", now)).toBeNull();
  });
});

describe("normalizePrivateKey", () => {
  it("restores escaped newlines so PEM keys survive env vars", async () => {
    const { normalizePrivateKey } = await import("@/lib/github-app");
    expect(normalizePrivateKey("-----BEGIN-----\\nabc\\n-----END-----")).toBe(
      "-----BEGIN-----\nabc\n-----END-----",
    );
    // An already-real-newline key is left alone.
    const real = "-----BEGIN-----\nabc\n-----END-----";
    expect(normalizePrivateKey(real)).toBe(real);
  });
});
