import { describe, expect, it } from "vitest";
import { MAX_ASSETS, validateAssetUrls } from "@/lib/brand-assets";

const BASE = "https://yivjxeyokdeeyfmzhwcw.supabase.co";
const ok = (p: string) => `${BASE}/storage/v1/object/public/brand-assets/${p}`;

describe("validateAssetUrls", () => {
  it("accepts our own brand-assets URLs", () => {
    const urls = [ok("brief-1/a.png"), ok("brief-1/b.jpg")];
    expect(validateAssetUrls(urls, BASE)).toEqual({ ok: true, urls });
  });

  it("rejects a foreign host even when the path mimics our bucket layout", () => {
    const r = validateAssetUrls(
      ["https://evil.example.com/storage/v1/object/public/brand-assets/a.png"],
      BASE,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects link-local metadata even when the path mimics our bucket layout", () => {
    const r = validateAssetUrls(
      ["http://169.254.169.254/storage/v1/object/public/brand-assets/a.png"],
      BASE,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a lookalike host", () => {
    const r = validateAssetUrls([`${BASE}.evil.com/storage/v1/object/public/brand-assets/a.png`], BASE);
    expect(r.ok).toBe(false);
  });

  it("rejects the footage bucket, which is a different trust domain", () => {
    const r = validateAssetUrls([`${BASE}/storage/v1/object/public/footage/a.webm`], BASE);
    expect(r.ok).toBe(false);
  });

  it("caps how many assets one brief can carry", () => {
    const many = Array.from({ length: MAX_ASSETS + 1 }, (_, i) => ok(`brief-1/${i}.png`));
    expect(validateAssetUrls(many, BASE).ok).toBe(false);
  });

  it("drops duplicates rather than fetching the same image twice", () => {
    const r = validateAssetUrls([ok("brief-1/a.png"), ok("brief-1/a.png")], BASE);
    expect(r).toEqual({ ok: true, urls: [ok("brief-1/a.png")] });
  });

  it("rejects an empty list", () => {
    expect(validateAssetUrls([], BASE).ok).toBe(false);
  });

  it("rejects a non-array value", () => {
    expect(validateAssetUrls("nope", BASE).ok).toBe(false);
    expect(validateAssetUrls(null, BASE).ok).toBe(false);
  });

  it("rejects non-string entries", () => {
    expect(validateAssetUrls([123 as unknown as string], BASE).ok).toBe(false);
  });

  it("refuses everything when storage is not configured", () => {
    expect(validateAssetUrls([ok("brief-1/a.png")], undefined).ok).toBe(false);
  });
});

describe("validateAssetUrls brief scoping", () => {
  const BRIEF = "brief-1";
  const mine = (p: string) => `${BASE}/storage/v1/object/public/brand-assets/${BRIEF}/${p}`;

  it("accepts images stored under the destination brief", () => {
    const urls = [mine("a.png")];
    expect(validateAssetUrls(urls, BASE, BRIEF)).toEqual({ ok: true, urls });
  });

  it("rejects a valid bucket image belonging to a different brief", () => {
    // The bucket is shared and public, so owning the destination brief says nothing about
    // owning the object. Without this an authenticated user could attach someone else's
    // screenshot and have Proof's vision and render services process it.
    const other = `${BASE}/storage/v1/object/public/brand-assets/brief-2/secret.png`;
    expect(validateAssetUrls([other], BASE, BRIEF).ok).toBe(false);
  });

  it("rejects a brief id used as a prefix of another", () => {
    const sneaky = `${BASE}/storage/v1/object/public/brand-assets/${BRIEF}-evil/a.png`;
    expect(validateAssetUrls([sneaky], BASE, BRIEF).ok).toBe(false);
  });

  it("still accepts any bucket path when no brief is given, for existing callers", () => {
    const any = `${BASE}/storage/v1/object/public/brand-assets/brief-9/a.png`;
    expect(validateAssetUrls([any], BASE).ok).toBe(true);
  });
});
