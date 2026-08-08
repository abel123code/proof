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

  // The densest screenshot is the one the feature exists for, and it is the one that overruns the
  // token cap. Production truncated mid-string on the SUTD deadline panel and the catch threw away
  // the caption too - so the hero image silently lost BOTH, having had a caption before.
  it("salvages the caption and whole items from a reply truncated mid-string", async () => {
    create.mockResolvedValue({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text:
        '{"caption":"Deadline Center over a calendar","items":[' +
        '{"text":"Deadline Center","region":"header","legible":true},' +
        '{"text":"SSW Homework 1","region":"list","legible":true},' +
        '{"text":"Due date: 2/24/26, 5:00 PM (UTC',
    });
    const out = await describeImageUrl("https://x/dense.png");

    expect(out.caption).toBe("Deadline Center over a calendar");
    expect(out.record?.items.map((i) => i.text)).toEqual(["Deadline Center", "SSW Homework 1"]);
  });

  it("keeps the caption even when no item survives the truncation", async () => {
    create.mockResolvedValue({
      status: "incomplete",
      output_text: '{"caption":"A busy dashboard","items":[{"text":"Deadl',
    });
    const out = await describeImageUrl("https://x/dense.png");

    expect(out.caption).toBe("A busy dashboard");
    expect(out.record).toBeNull();
  });

  it("asks for enough tokens that a dense screenshot is not truncated by default", async () => {
    create.mockResolvedValue(reply({ caption: "x", items: [] }));
    await describeImageUrl("https://x/a.png");

    // 48 extracted strings measured on a real Gradescope capture came to roughly 2k tokens on
    // their own, so the old 2000 cap could not fit a caption and a full page of interface text.
    expect(create.mock.calls[0][0].max_output_tokens).toBeGreaterThanOrEqual(8000);
  });

  it("survives an empty reply", async () => {
    create.mockResolvedValue({});
    const out = await describeImageUrl("https://x/a.png");

    expect(out.caption).toBe("");
    expect(out.record).toBeNull();
  });
});
