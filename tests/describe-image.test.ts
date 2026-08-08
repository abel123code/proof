import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The detail level is the load-bearing assertion here. At `detail: "low"` the image is downsampled
 * until 14px interface text is unreadable - enough to caption "a deadline list", nowhere near
 * enough to read "10.016". Extracting text at low detail would produce confident nonsense, so the
 * first test pins it.
 */

const create = vi.fn();
vi.mock("@/lib/openai", () => ({
  getOpenAI: () => ({ responses: { create: (...a: unknown[]) => create(...a) } }),
  OPENAI_MINI_MODEL: "test-mini",
}));

const { describeImageUrl } = await import("@/lib/describe-image");

const reply = (obj: unknown) => ({ output_text: JSON.stringify(obj) });

beforeEach(() => vi.clearAllMocks());

describe("describeImageUrl", () => {
  it("reads the image at high detail, because the small text is the point", async () => {
    create.mockResolvedValue(reply({ caption: "A deadline list", items: [] }));
    await describeImageUrl("https://x/a.png");

    expect(JSON.stringify(create.mock.calls[0][0])).toContain('"detail":"high"');
  });

  it("returns the caption and the normalised record together", async () => {
    create.mockResolvedValue(
      reply({
        caption: "Deadline Center over a calendar",
        items: [{ text: "Homework 1", region: "list", legible: true }],
      }),
    );
    const out = await describeImageUrl("https://x/a.png");

    expect(out.caption).toBe("Deadline Center over a calendar");
    expect(out.record).toEqual({ items: [{ text: "Homework 1", region: "list", legible: true }] });
  });

  it("still yields a caption when the record is unusable", async () => {
    create.mockResolvedValue(reply({ caption: "A logo", items: "nonsense" }));
    const out = await describeImageUrl("https://x/a.png");

    expect(out.caption).toBe("A logo");
    expect(out.record).toBeNull();
  });

  it("returns no record for an image with no interface text", async () => {
    create.mockResolvedValue(reply({ caption: "A phone on a desk", items: [] }));
    const out = await describeImageUrl("https://x/photo.jpg");

    expect(out.caption).toBe("A phone on a desk");
    expect(out.record).toBeNull();
  });

  it("survives a non-JSON reply instead of throwing into the upload path", async () => {
    create.mockResolvedValue({ output_text: "not json at all" });
    const out = await describeImageUrl("https://x/a.png");

    expect(out.caption).toBe("");
    expect(out.record).toBeNull();
  });

  it("survives an empty reply", async () => {
    create.mockResolvedValue({});
    const out = await describeImageUrl("https://x/a.png");

    expect(out.caption).toBe("");
    expect(out.record).toBeNull();
  });
});
