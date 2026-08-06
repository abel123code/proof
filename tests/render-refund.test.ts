import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A render is charged before the job is handed to the worker, and refunded only if the
 * worker never accepts it. Once accepted, any later failure (ffmpeg segfault, OOM, a
 * Railway restart, an OpenAI timeout) burned the full 80 credits with no refund: 8% of a
 * user's lifetime balance for an outage that was ours, not theirs.
 *
 * The hard part is refunding exactly once. This handler runs every 4 seconds per open tab
 * for as long as the failed job is on screen, so a naive refund pays out forever.
 */

const requireApprovedUser = vi.fn();
const getRenderJob = vi.fn();
const saveBriefRender = vi.fn();
const assertBriefOwnedBy = vi.fn();
const claimRenderRefund = vi.fn();
const refundCredits = vi.fn();

vi.mock("@/lib/auth", () => ({ requireApprovedUser: () => requireApprovedUser() }));
vi.mock("@/lib/db", () => ({
  assertBriefOwnedBy: (...a: unknown[]) => assertBriefOwnedBy(...a),
  getRenderJob: (...a: unknown[]) => getRenderJob(...a),
  saveBriefRender: (...a: unknown[]) => saveBriefRender(...a),
  claimRenderRefund: (...a: unknown[]) => claimRenderRefund(...a),
  refundCredits: (...a: unknown[]) => refundCredits(...a),
  clearBriefRender: vi.fn(),
  createRenderJob: vi.fn(),
  failRenderJob: vi.fn(),
  getBriefById: vi.fn(),
  spendCredits: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));

const FAILED = {
  status: "error",
  phase: "error",
  progress: 40,
  outputUrl: null,
  error: "ffmpeg exited with 139",
};

async function poll() {
  const { GET } = await import("@/app/api/render/route");
  return GET(new Request("http://localhost/api/render?jobId=job-1&briefId=brief-1"));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApprovedUser.mockResolvedValue({ ok: true, userId: "user-a" });
  assertBriefOwnedBy.mockResolvedValue(true);
  saveBriefRender.mockResolvedValue(true);
  getRenderJob.mockResolvedValue(FAILED);
});

describe("refund on a failed render", () => {
  it("gives the credits back when the job failed after being accepted", async () => {
    claimRenderRefund.mockResolvedValue(true);
    const res = await poll();

    expect(claimRenderRefund).toHaveBeenCalledWith("job-1", "user-a");
    expect(refundCredits).toHaveBeenCalledWith("user-a", 80);
    expect((await res.json()).status).toBe("error");
  });

  it("refunds once even though the browser polls every few seconds", async () => {
    // Exactly one caller wins the conditional update; the rest see refunded_at set.
    claimRenderRefund.mockResolvedValueOnce(true).mockResolvedValue(false);
    for (let i = 0; i < 6; i++) await poll();

    expect(claimRenderRefund).toHaveBeenCalledTimes(6);
    expect(refundCredits).toHaveBeenCalledTimes(1);
  });

  it("does not refund a render that is still running", async () => {
    getRenderJob.mockResolvedValue({ ...FAILED, status: "processing", phase: "rendering" });
    await poll();

    expect(claimRenderRefund).not.toHaveBeenCalled();
    expect(refundCredits).not.toHaveBeenCalled();
  });

  it("does not refund a render that succeeded", async () => {
    getRenderJob.mockResolvedValue({ ...FAILED, status: "done", outputUrl: "https://x/v.mp4" });
    await poll();

    expect(claimRenderRefund).not.toHaveBeenCalled();
    expect(refundCredits).not.toHaveBeenCalled();
  });

  it("still reports the failure to the user when the refund itself breaks", async () => {
    // Losing the refund is bad; swallowing the render failure on top of it is worse,
    // because then the UI never leaves the spinner.
    claimRenderRefund.mockRejectedValue(new Error("db down"));
    const res = await poll();

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("error");
  });

  it("rejects a poll for a brief the caller does not own before any refund", async () => {
    assertBriefOwnedBy.mockResolvedValue(false);
    const res = await poll();

    expect(res.status).toBe(403);
    expect(claimRenderRefund).not.toHaveBeenCalled();
    expect(refundCredits).not.toHaveBeenCalled();
  });
});
