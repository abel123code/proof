import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { openSignupEnabled } from "@/lib/signup";

/**
 * Open signup exists so judges can test without waiting to be approved. The danger is not
 * the open door, it is an open door with no ceiling: USER_CAP is what stops a stranger
 * draining the OpenAI budget and the 1GB of Supabase storage, so it has to survive.
 */

/** Per-table responses for the Supabase query builder, plus a record of what was called. */
let profileRow: unknown = null;
let allowRows: unknown[] = [];
let profileCount = 0;
const inserts: Array<{ table: string; values: unknown }> = [];

function makeClient() {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      for (const m of ["select", "eq", "or", "limit", "is", "order"]) q[m] = chain;

      q.select = (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) {
          // countProfiles(): terminal, resolves straight to a count.
          (q as { then: unknown }).then = (r: (v: unknown) => void) =>
            r({ count: profileCount, error: null });
        }
        return q;
      };
      q.maybeSingle = async () => ({
        data: table === "profiles" ? profileRow : null,
        error: null,
      });
      q.insert = async (values: unknown) => {
        inserts.push({ table, values });
        return { error: null };
      };
      (q as { then: unknown }).then = (r: (v: unknown) => void) =>
        r({ data: table === "allowed_users" ? allowRows : [], error: null, count: profileCount });
      return q;
    },
  };
}

vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => makeClient() }));

const NEWCOMER = { userId: "u-new", email: "judge@example.com", githubUsername: null };

beforeEach(() => {
  vi.clearAllMocks();
  profileRow = null; // not an existing user
  allowRows = []; // not on the allowlist
  profileCount = 5; // well under the cap
  inserts.length = 0;
  delete process.env.NEXT_PUBLIC_OPEN_SIGNUP;
  delete process.env.USER_CAP;
});

describe("openSignupEnabled", () => {
  it("stays closed unless explicitly switched on", () => {
    // Default-closed matters: merging this code must not change production behaviour
    // until someone deliberately sets the env var.
    for (const raw of [undefined, "", "false", "0", "no", "TRUE", "yes", "  true  "]) {
      expect(openSignupEnabled(raw)).toBe(false);
    }
  });

  it("opens on the two spellings anyone would actually use", () => {
    expect(openSignupEnabled("true")).toBe(true);
    expect(openSignupEnabled("1")).toBe(true);
  });
});

describe("ensureProfile admission", () => {
  it("turns a stranger away while the allowlist is in force", async () => {
    const { ensureProfile } = await import("@/lib/db");
    expect(await ensureProfile(NEWCOMER)).toBe("pending");
    expect(inserts.some((i) => i.table === "profiles")).toBe(false);
  });

  it("lets the same stranger straight in once signup is open", async () => {
    process.env.NEXT_PUBLIC_OPEN_SIGNUP = "true";
    const { ensureProfile } = await import("@/lib/db");

    expect(await ensureProfile(NEWCOMER)).toBe("active");
    expect(inserts.some((i) => i.table === "profiles")).toBe(true);
  });

  it("STILL enforces the cap when signup is open", async () => {
    // The whole risk of an open door. Without this the OpenAI budget and the 1GB of
    // Supabase storage have nothing standing in front of them.
    process.env.NEXT_PUBLIC_OPEN_SIGNUP = "true";
    process.env.USER_CAP = "10";
    profileCount = 10;
    const { ensureProfile } = await import("@/lib/db");

    expect(await ensureProfile(NEWCOMER)).toBe("full");
    expect(inserts.some((i) => i.table === "profiles")).toBe(false);
  });

  it("still short-circuits for somebody who already has a profile", async () => {
    process.env.NEXT_PUBLIC_OPEN_SIGNUP = "true";
    profileRow = { user_id: "u-new", email: "judge@example.com" };
    const { ensureProfile } = await import("@/lib/db");

    expect(await ensureProfile(NEWCOMER)).toBe("active");
    expect(inserts).toHaveLength(0);
  });
});

describe("reversibility", () => {
  const db = readFileSync("src/lib/db.ts", "utf8").replace(/\s+/g, " ");

  it("keeps the allowlist path intact so the gate can be put back with an env change", () => {
    // Deleting the allowlist would make re-closing signup a code change and a deploy,
    // which is the whole reason this is a flag rather than a removal.
    expect(db).toContain("isAllowlisted");
    expect(db).toContain("recordAccessRequest");
  });
});

describe("login copy", () => {
  const login = readFileSync("src/app/login/page.tsx", "utf8").replace(/\s+/g, " ");

  it("stops claiming invite-only when signup is open", () => {
    // Verified live in both states at 1440px and iPhone 13; this pins it so a later copy
    // edit cannot quietly reintroduce "you need an invite" on a page that lets you in.
    expect(login).toContain("openSignup ?");
    expect(login).toMatch(/openSignup \? "" : " Proof is invite-only/);
  });
});
