import { describe, expect, it } from "vitest";
import { sanitizeAssets, MAX_ASSET_IMAGES } from "@/lib/assets";

describe("sanitizeAssets", () => {
  it("keeps only http(s) image URLs, trimmed", () => {
    const out = sanitizeAssets({
      images: [" https://x/a.png ", "http://y/b.jpg", "javascript:alert(1)", "not a url", 42],
    });
    expect(out.images).toEqual(["https://x/a.png", "http://y/b.jpg"]);
  });

  it("caps the number of images", () => {
    const many = Array.from({ length: MAX_ASSET_IMAGES + 5 }, (_, i) => `https://x/${i}.png`);
    expect(sanitizeAssets({ images: many }).images).toHaveLength(MAX_ASSET_IMAGES);
  });

  it("trims text fields and drops blanks", () => {
    const out = sanitizeAssets({ brandColor: " #d9ff45 ", motif: "  ", brandVoice: "" });
    expect(out.brandColor).toBe("#d9ff45");
    expect(out.motif).toBeUndefined();
    expect(out.brandVoice).toBeUndefined();
  });

  it("returns an empty object when nothing valid is supplied", () => {
    expect(sanitizeAssets({})).toEqual({});
    expect(sanitizeAssets({ images: "nope", brandColor: 5 })).toEqual({});
  });
});
