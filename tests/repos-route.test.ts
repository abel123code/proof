import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Route-level tests. The pure cache/limiter is covered in repo-list-guard.test.ts; this proves it is
 * actually WIRED INTO the endpoint, which is a separate claim and the one that broke last time.
 */

const listUserRepos = vi.fn();
const getProfile = vi.fn();
const requireApprovedUser = vi.fn();

vi.mock("@/lib/github", () => ({
  listUserRepos: (...a: unknown[]) => listUserRepos(...a),
}));
vi.mock("@/lib/db", () => ({
  getProfile: (...a: unknown[]) => getProfile(...a),
}));
vi.mock("@/lib/auth", () => ({
  requireApprovedUser: (...a: unknown[]) => requireApprovedUser(...a),
}));
vi.mock("@/lib/github-app", () => ({
  githubAppConfigured: () => false,
  listInstallationRepos: vi.fn(),
}));

const repo = (fullName: string) => ({
  name: fullName.split("/")[1],
  fullName,
  url: `https://github.com/${fullName}`,
  description: null,
  language: "TypeScript",
  stars: 1,
  pushedAt: "2026-07-01T00:00:00Z",
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { __resetRepoListGuard } = await import("@/lib/repo-list-guard");
  __resetRepoListGuard();
  requireApprovedUser.mockResolvedValue({ ok: true, userId: "user-a" });
  getProfile.mockResolvedValue({ githubUsername: "abhishekvulla", githubInstallationId: null });
});

async function call(url: string) {
  const { GET } = await import("@/app/api/github/repos/route");
  return GET(new Request(url));
}

describe("GET /api/github/repos", () => {
  it("lists SOMEBODY ELSE's public repos (open by design)", async () => {
    listUserRepos.mockResolvedValue([repo("vercel/next.js")]);
    const res = await call("http://localhost/api/github/repos?username=vercel");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(listUserRepos).toHaveBeenCalledWith("vercel");
    expect(body.repos[0].fullName).toBe("vercel/next.js");
    expect(body.repos[0].isPrivate).toBe(false);
  });

  it("serves a repeat lookup from cache without touching GitHub", async () => {
    listUserRepos.mockResolvedValue([repo("torvalds/linux")]);
    await call("http://localhost/api/github/repos?username=torvalds");
    await call("http://localhost/api/github/repos?username=torvalds");
    await call("http://localhost/api/github/repos?username=TORVALDS");
    // The quota protection: three requests, one GitHub call, case-insensitive.
    expect(listUserRepos).toHaveBeenCalledTimes(1);
  });

  it("returns 429 once one user burns through distinct lookups", async () => {
    listUserRepos.mockImplementation(async () => [repo("x/y")]);
    // Distinct handles so every request is a cache MISS and counts against the window.
    let last: Response | undefined;
    for (let i = 0; i < 40; i++) {
      last = await call(`http://localhost/api/github/repos?username=user${i}`);
    }
    expect(last!.status).toBe(429);
    const body = await last!.json();
    expect(body.error).toMatch(/too many/i);
  });

  it("rejects an unauthenticated caller before any GitHub work", async () => {
    requireApprovedUser.mockResolvedValue({ ok: false, status: 401, error: "Unauthorized" });
    const res = await call("http://localhost/api/github/repos?username=vercel");
    expect(res.status).toBe(401);
    expect(listUserRepos).not.toHaveBeenCalled();
  });
});
