import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Route-level tests for the two endpoints that let a brief carry its own screenshots
 * and brand colour: POST /api/assets and POST /api/assets/sign. The pure URL allowlist
 * is covered in brand-assets.test.ts; this proves the ORDERING of the guards in front
 * of it, because that ordering is the security property — a ticket must never be minted,
 * and a brief must never be written, before ownership is established.
 *
 * Follows the module-boundary mocking pattern from repos-route.test.ts: mock @/lib/auth
 * and @/lib/db, let everything else (including the real validateAssetUrls) run for real.
 */

const requireApprovedUser = vi.fn();
const assertBriefOwnedBy = vi.fn();
const setBriefAssets = vi.fn();
const createAssetUploadTicket = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireApprovedUser: (...a: unknown[]) => requireApprovedUser(...a),
}));
vi.mock("@/lib/db", () => ({
  assertBriefOwnedBy: (...a: unknown[]) => assertBriefOwnedBy(...a),
  setBriefAssets: (...a: unknown[]) => setBriefAssets(...a),
  createAssetUploadTicket: (...a: unknown[]) => createAssetUploadTicket(...a),
  getBriefAssetDescriptions: async () => ({}),
}));

// Captioning is a vision call; stub it so the route tests stay offline and deterministic.
vi.mock("@/lib/describe-image", () => ({
  describeImageUrl: async () => "A deadline list, panel centred",
}));

const SUPABASE_URL = "https://yivjxeyokdeeyfmzhwcw.supabase.co";
const ok = (p: string) => `${SUPABASE_URL}/storage/v1/object/public/brand-assets/${p}`;

function postJson(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  requireApprovedUser.mockResolvedValue({ ok: true, userId: "user-a" });
  assertBriefOwnedBy.mockResolvedValue(true);
  setBriefAssets.mockResolvedValue(undefined);
  createAssetUploadTicket.mockResolvedValue({ path: "brief-1/uuid.png", token: "tok" });
});

describe("POST /api/assets", () => {
  async function call(body: unknown) {
    const { POST } = await import("@/app/api/assets/route");
    return POST(postJson("http://localhost/api/assets", body));
  }

  it("rejects an unapproved user before ownership is even checked", async () => {
    requireApprovedUser.mockResolvedValue({ ok: false, status: 403, error: "Your account is pending approval." });
    const res = await call({ briefId: "brief-1", images: [ok("a.png")] });

    expect(res.status).toBe(403);
    expect(assertBriefOwnedBy).not.toHaveBeenCalled();
    expect(setBriefAssets).not.toHaveBeenCalled();
  });

  it("refuses an approved user who does not own the brief, and never touches it", async () => {
    assertBriefOwnedBy.mockResolvedValue(false);
    const res = await call({ briefId: "brief-1", images: [ok("a.png")] });

    expect(res.status).toBe(403);
    expect(setBriefAssets).not.toHaveBeenCalled();
  });

  it("rejects a foreign-host URL from the owner, and never touches the brief", async () => {
    const res = await call({ briefId: "brief-1", images: ["https://evil.example.com/a.png"] });

    expect(res.status).toBe(400);
    expect(setBriefAssets).not.toHaveBeenCalled();
  });

  it("accepts the owner's valid URLs and persists them on the brief", async () => {
    const images = [ok("a.png"), ok("b.png")];
    const res = await call({ briefId: "brief-1", images });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, images });
    // Each image is captioned on the way in, keyed by the filename the render worker will
    // stage it under, so the planner can tell what it actually has.
    expect(setBriefAssets).toHaveBeenCalledWith("brief-1", {
      images,
      brandColor: undefined,
      imageDescriptions: {
        "a.png": "A deadline list, panel centred",
        "b.png": "A deadline list, panel centred",
      },
    });
  });
});

describe("POST /api/assets/sign", () => {
  async function call(body: unknown) {
    const { POST } = await import("@/app/api/assets/sign/route");
    return POST(postJson("http://localhost/api/assets/sign", body));
  }

  it("refuses a non-owner and mints no ticket", async () => {
    assertBriefOwnedBy.mockResolvedValue(false);
    const res = await call({ briefId: "brief-1", contentType: "image/png" });

    expect(res.status).toBe(403);
    expect(createAssetUploadTicket).not.toHaveBeenCalled();
  });

  it("rejects a disallowed content type and mints no ticket", async () => {
    const res = await call({ briefId: "brief-1", contentType: "image/svg+xml" });

    expect(res.status).toBe(400);
    expect(createAssetUploadTicket).not.toHaveBeenCalled();
    // Ownership must not leak ahead of input validation either.
    expect(assertBriefOwnedBy).not.toHaveBeenCalled();
  });

  it("mints a ticket for the owner with an allowed content type", async () => {
    const res = await call({ briefId: "brief-1", contentType: "image/png" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ path: "brief-1/uuid.png", token: "tok" });
    expect(createAssetUploadTicket).toHaveBeenCalledWith({ briefId: "brief-1", contentType: "image/png" });
  });
});
