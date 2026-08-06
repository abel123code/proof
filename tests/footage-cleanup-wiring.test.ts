import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * There is no scheduler in this repo, so draining a finished brief's raw footage rides
 * on the traffic that creates the mess: the next time this same user hits POST
 * /api/render. This proves the wiring, not the drain policy itself (that's
 * footage-cleanup.test.ts) — specifically that the brief being rendered right now is
 * never a candidate, and that a broken drain can never surface as a broken render.
 *
 * Follows the module-boundary mocking pattern from brand-assets-route.test.ts: mock
 * @/lib/auth and @/lib/db, stub global fetch for the render worker call, let the real
 * @/lib/footage-cleanup and @/lib/render-submit logic run.
 */

const requireApprovedUser = vi.fn();
const assertBriefOwnedBy = vi.fn();
const findActiveRenderJob = vi.fn();
const spendCredits = vi.fn();
const createRenderJob = vi.fn();
const saveBriefRender = vi.fn();
const failRenderJob = vi.fn();
const refundCredits = vi.fn();
const listFootageCleanupCandidates = vi.fn();
const removeBriefFootage = vi.fn();
const forgetBriefFootage = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireApprovedUser: (...a: unknown[]) => requireApprovedUser(...a),
}));
vi.mock("@/lib/db", () => ({
  assertBriefOwnedBy: (...a: unknown[]) => assertBriefOwnedBy(...a),
  findActiveRenderJob: (...a: unknown[]) => findActiveRenderJob(...a),
  spendCredits: (...a: unknown[]) => spendCredits(...a),
  createRenderJob: (...a: unknown[]) => createRenderJob(...a),
  saveBriefRender: (...a: unknown[]) => saveBriefRender(...a),
  failRenderJob: (...a: unknown[]) => failRenderJob(...a),
  refundCredits: (...a: unknown[]) => refundCredits(...a),
  listFootageCleanupCandidates: (...a: unknown[]) => listFootageCleanupCandidates(...a),
  removeBriefFootage: (...a: unknown[]) => removeBriefFootage(...a),
  forgetBriefFootage: (...a: unknown[]) => forgetBriefFootage(...a),
  getRenderJob: vi.fn(),
  claimRenderRefund: vi.fn(),
  clearBriefRender: vi.fn(),
  getBriefById: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));

const SUPABASE_URL = "https://yivjxeyokdeeyfmzhwcw.supabase.co";
const clipUrl = (p: string) => `${SUPABASE_URL}/storage/v1/object/public/footage/${p}`;

const ACTIVE_BRIEF = "brief-active";
const OTHER_DONE_BRIEF = "brief-other-done";

function postJson(body: unknown) {
  return new Request("http://localhost/api/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/render/route");
  return POST(postJson(body));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;

  requireApprovedUser.mockResolvedValue({ ok: true, userId: "user-a" });
  assertBriefOwnedBy.mockResolvedValue(true);
  findActiveRenderJob.mockResolvedValue(null);
  spendCredits.mockResolvedValue({ ok: true, remaining: 20 });
  createRenderJob.mockResolvedValue(undefined);
  saveBriefRender.mockResolvedValue(true);
  listFootageCleanupCandidates.mockResolvedValue([]);
  removeBriefFootage.mockResolvedValue(undefined);
  forgetBriefFootage.mockResolvedValue(undefined);

  // Echo the durable jobId back so the route's "did the worker accept our id" check passes.
  const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    return {
      ok: true,
      status: 200,
      json: async () => ({ jobId: body.jobId }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderBody(briefId: unknown) {
  return { briefId, videoUrls: [clipUrl("scene-0.webm")], brief: { script: "x" } };
}

describe("footage drain wired into POST /api/render", () => {
  it("excludes the brief currently being rendered even when it otherwise qualifies for cleanup", async () => {
    listFootageCleanupCandidates.mockResolvedValue([
      { id: ACTIVE_BRIEF, renderStatus: "done", renderUrl: "https://x/out.mp4", footageCount: 3 },
      { id: OTHER_DONE_BRIEF, renderStatus: "done", renderUrl: "https://x/out2.mp4", footageCount: 2 },
    ]);

    const res = await post(renderBody(ACTIVE_BRIEF));
    expect(res.status).toBe(200);

    expect(removeBriefFootage).toHaveBeenCalledTimes(1);
    expect(removeBriefFootage).toHaveBeenCalledWith(OTHER_DONE_BRIEF);
    expect(removeBriefFootage).not.toHaveBeenCalledWith(ACTIVE_BRIEF);
    expect(forgetBriefFootage).toHaveBeenCalledWith(OTHER_DONE_BRIEF);
  });

  it("does not let a cleanup failure change the render response", async () => {
    listFootageCleanupCandidates.mockRejectedValue(new Error("db down"));

    const res = await post(renderBody(ACTIVE_BRIEF));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ jobId: expect.any(String), creditsRemaining: 20 });
  });

  it("does not drain when the request body is missing a briefId", async () => {
    const res = await post({ videoUrls: [clipUrl("scene-0.webm")], brief: { script: "x" } });

    expect(res.status).toBe(400);
    expect(listFootageCleanupCandidates).not.toHaveBeenCalled();
  });

  it("does not drain when the caller does not own the brief", async () => {
    assertBriefOwnedBy.mockResolvedValue(false);

    const res = await post(renderBody(ACTIVE_BRIEF));

    expect(res.status).toBe(403);
    expect(listFootageCleanupCandidates).not.toHaveBeenCalled();
  });

  it("does not drain when the user is out of credits", async () => {
    spendCredits.mockResolvedValue({ ok: false, remaining: 0 });

    const res = await post(renderBody(ACTIVE_BRIEF));

    expect(res.status).toBe(402);
    expect(listFootageCleanupCandidates).not.toHaveBeenCalled();
  });
});
