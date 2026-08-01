import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

/**
 * Behavioural tests for the waitlist page.
 *
 * An earlier version of this suite asserted that the SOURCE contained the strings
 * "ensureProfile" and "redirect(", which would have passed if either word appeared in a
 * comment, and proved nothing about what a user actually experiences. These invoke the
 * page with its dependencies mocked and assert each observable outcome instead.
 */

const getAuthUser = vi.fn();
const isAuthConfigured = vi.fn(() => true);
const ensureProfile = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuthUser: () => getAuthUser(),
  isAuthConfigured: () => isAuthConfigured(),
}));
vi.mock("@/lib/db", () => ({ ensureProfile: (i: unknown) => ensureProfile(i) }));

// The real redirect() signals by throwing, and the page relies on that to stop executing.
// Mirroring it keeps the control flow honest instead of letting the page run on.
class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

/** Collect every string in a rendered element tree, so copy can be asserted directly. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  const props = (node as { props?: { children?: ReactNode } }).props;
  return props ? textOf(props.children) : "";
}

async function render(status?: string) {
  const { default: PendingPage } = await import("@/app/pending/page");
  return PendingPage({ searchParams: Promise.resolve(status ? { status } : {}) });
}

async function redirectTargetOf(status?: string): Promise<string> {
  try {
    await render(status);
  } catch (e) {
    if (e instanceof RedirectSignal) return e.to;
    throw e;
  }
  return "";
}

beforeEach(() => {
  vi.clearAllMocks();
  isAuthConfigured.mockReturnValue(true);
  getAuthUser.mockResolvedValue({ id: "u1", email: "a@b.com", githubUsername: null });
  delete process.env.USER_CAP;
});

describe("PendingPage", () => {
  it("lets an approved user through instead of stranding them", async () => {
    // The trap this page exists to fix: ensureProfile only ran in the OAuth callback, so
    // approval after sign-in never took effect and the user bounced back here forever.
    ensureProfile.mockResolvedValue("active");
    expect(await redirectTargetOf()).toBe("/connect");
    expect(ensureProfile).toHaveBeenCalledWith({
      userId: "u1",
      email: "a@b.com",
      githubUsername: null,
    });
  });

  it("sends a signed-out visitor to login without touching the database", async () => {
    getAuthUser.mockResolvedValue(null);
    expect(await redirectTargetOf()).toBe("/login");
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it("tells a waitlisted user to come back, and never mentions an email", async () => {
    ensureProfile.mockResolvedValue("pending");
    const text = textOf(await render());

    expect(text).toContain("on the list");
    expect(text).toMatch(/refresh this page/i);
    // There is no email provider in this repo, so promising one is a lie by construction.
    expect(text).not.toMatch(/email/i);
  });

  it("says something different when the cap is the blocker, and names the real cap", async () => {
    process.env.USER_CAP = "120";
    ensureProfile.mockResolvedValue("full");
    const text = textOf(await render());

    // "You're on the list" still appears here, deliberately, as reassurance. What must
    // differ is the headline reason and the cap it names.
    expect(text).toContain("Early access is full");
    expect(text).toContain("120");
    expect(text).not.toContain("waiting to be approved");
  });

  it("does not disguise a failed lookup as a waitlist result", async () => {
    // Previously the failure was swallowed into null and rendered as "You're on the list".
    // An approved user hitting a transient DB error was told something false and had no
    // way to tell the difference from genuinely waiting.
    ensureProfile.mockRejectedValue(new Error("db down"));
    const text = textOf(await render());

    expect(text).toMatch(/could not check your access/i);
    expect(text).toMatch(/on our side/i);
    expect(text).not.toContain("on the list");
  });

  it("reads the status param, so a capped-out user is not shown waitlist copy", async () => {
    ensureProfile.mockResolvedValue("pending");
    const text = textOf(await render("full"));
    expect(text).toContain("full");
  });

  it("renders without a database when auth is disabled locally", async () => {
    isAuthConfigured.mockReturnValue(false);
    const text = textOf(await render());

    expect(text).toContain("on the list");
    expect(getAuthUser).not.toHaveBeenCalled();
    expect(ensureProfile).not.toHaveBeenCalled();
  });
});
