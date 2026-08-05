import { describe, expect, it } from "vitest";
import { MAX_CLIPS, validateVideoUrls } from "@/lib/media-url";

const BASE = "https://yivjxeyokdeeyfmzhwcw.supabase.co";
const ok = (p: string) => `${BASE}/storage/v1/object/public/footage/${p}`;

describe("validateVideoUrls", () => {
  it("accepts our own storage URLs", () => {
    const urls = [ok("scene-0.webm"), ok("scene-1.webm")];
    expect(validateVideoUrls(urls, BASE)).toEqual({ ok: true, urls });
  });

  it("rejects a different host", () => {
    expect(validateVideoUrls(["https://evil.example.com/a.mp4"], BASE).ok).toBe(false);
  });

  it("rejects link-local metadata addresses", () => {
    expect(validateVideoUrls(["http://169.254.169.254/latest/meta-data/"], BASE).ok).toBe(false);
  });

  it("rejects non-http schemes and bare paths", () => {
    expect(validateVideoUrls(["file:///etc/passwd"], BASE).ok).toBe(false);
    expect(validateVideoUrls(["/var/run/secrets"], BASE).ok).toBe(false);
  });

  it("rejects our host but a different bucket", () => {
    expect(validateVideoUrls([`${BASE}/storage/v1/object/public/private-stuff/x.mp4`], BASE).ok).toBe(false);
  });

  it("rejects a path that escapes the bucket prefix", () => {
    expect(validateVideoUrls([`${BASE}/storage/v1/object/public/footage/../secrets/x`], BASE).ok).toBe(false);
  });

  it("rejects a lookalike host", () => {
    expect(validateVideoUrls(["https://yivjxeyokdeeyfmzhwcw.supabase.co.evil.com/a.mp4"], BASE).ok).toBe(false);
  });

  it("caps the number of clips", () => {
    const many = Array.from({ length: MAX_CLIPS + 1 }, (_, i) => ok(`s${i}.webm`));
    expect(validateVideoUrls(many, BASE).ok).toBe(false);
  });

  it("rejects an empty list", () => {
    expect(validateVideoUrls([], BASE).ok).toBe(false);
  });

  it("rejects non-string entries", () => {
    expect(validateVideoUrls([123 as unknown as string], BASE).ok).toBe(false);
  });

  it("refuses everything when storage is not configured", () => {
    expect(validateVideoUrls([ok("a.webm")], undefined).ok).toBe(false);
  });
});
