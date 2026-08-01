import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regression tests for a VERIFIED production auth bypass.
 *
 * `isAllowlisted` built a PostgREST `.or()` filter by string-interpolating the GitHub
 * handle, and that handle came from `user.user_metadata.user_name` — which Supabase lets
 * the user write themselves via `auth.updateUser({ data: ... })`. Setting it to
 * `x,id.not.is.null` produced the filter `github_username.eq.x,id.not.is.null`, whose
 * second term is true for every row, so the allowlist check passed for anybody.
 *
 * Confirmed read-only against the live database on 2026-08-01:
 *   or=(github_username.eq.notarealhandle)                  -> []
 *   or=(github_username.eq.notarealhandle,id.not.is.null)   -> [{"id":"3cb6b8f1-..."}]
 *
 * Two independent things were wrong, so both are pinned here: the filter was injectable,
 * AND authorization trusted an attacker-writable field. Escaping alone would have left
 * impersonation open the moment an admin allowlisted anyone by handle.
 */

const calls: Array<{ method: string; args: unknown[] }> = [];

function makeQuery() {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "limit", "ilike", "in"]) {
    q[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return q;
    };
  }
  // Awaiting the builder resolves to a PostgREST-shaped response.
  (q as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null });
  return q;
}

const getSupabaseAdmin = vi.fn(() => ({ from: () => makeQuery() }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => getSupabaseAdmin() }));

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("isAllowlisted", () => {
  it("never builds a raw .or() filter, which is what made injection possible", async () => {
    const { isAllowlisted } = await import("@/lib/db");
    await isAllowlisted("someone@example.com");

    expect(calls.some((c) => c.method === "or")).toBe(false);
    expect(calls.some((c) => c.method === "eq")).toBe(true);
  });

  it("matches on the provider-verified email, passed as a bound value", async () => {
    const { isAllowlisted } = await import("@/lib/db");
    await isAllowlisted("Someone@Example.com");

    const eq = calls.find((c) => c.method === "eq");
    expect(eq?.args[0]).toBe("email");
    // Normalised, and passed as an argument rather than concatenated into a filter
    // string, so a comma or a PostgREST operator in it cannot change the query shape.
    expect(eq?.args[1]).toBe("someone@example.com");
  });

  it("treats the historic injection payload as an ordinary non-matching email", async () => {
    const { isAllowlisted } = await import("@/lib/db");
    const payload = "attacker@example.com,id.not.is.null";
    const result = await isAllowlisted(payload);

    expect(result).toBe(false);
    const eq = calls.find((c) => c.method === "eq");
    // The whole payload lands in the VALUE slot. It cannot escape into the filter.
    expect(eq?.args[1]).toBe(payload.toLowerCase());
    expect(calls.some((c) => c.method === "or")).toBe(false);
  });

  it("refuses to query at all without an email, rather than matching broadly", async () => {
    const { isAllowlisted } = await import("@/lib/db");
    for (const value of [null, "", "   "]) {
      expect(await isAllowlisted(value)).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });
});
