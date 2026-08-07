import { describe, expect, it, vi, afterEach } from "vitest";
import { ACCEPTED_ASSET_TYPES, MAX_ASSET_BYTES, uploadBrandAsset } from "@/lib/upload-asset";

/**
 * Client-side pre-flight + wire-format tests for uploadBrandAsset, the brand-asset
 * sibling of uploadSceneFootageDirect (see tests/upload-size.test.ts for that one).
 * Mirrors its pattern: stub `fetch` to prove the pre-flight checks never spend a
 * network call on a file the server would reject anyway, and stub `XMLHttpRequest`
 * (the wire format upload.ts and this module both use) to prove a good file actually
 * reaches the signed URL.
 */

const fakeFile = (bytes: number, type = "image/png") => ({ size: bytes, type }) as File;

function realFile(bytes: number, type = "image/png"): File {
  return new File([new Uint8Array(bytes)], "shot.png", { type });
}

class FakeXHR {
  static instances: FakeXHR[] = [];
  status = 200;
  timeout = 0;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    FakeXHR.instances.push(this);
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
    queueMicrotask(() => this.onload?.());
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXHR.instances.length = 0;
});

describe("ACCEPTED_ASSET_TYPES", () => {
  it("is exactly the three raster types the server allows", () => {
    expect(ACCEPTED_ASSET_TYPES).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });
});

describe("uploadBrandAsset pre-flight", () => {
  it("rejects a file over the limit before any fetch happens", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      uploadBrandAsset({ briefId: "brief-1", file: fakeFile(MAX_ASSET_BYTES + 1) }),
    ).rejects.toThrow(/15MB/);

    // The point of checking first: no ticket minted, no PUT started, for a file the
    // server would bounce anyway.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lets a file exactly on the limit through the size check", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "stop here, the size check already passed" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      uploadBrandAsset({ briefId: "brief-1", file: fakeFile(MAX_ASSET_BYTES) }),
    ).rejects.toThrow(/stop here/);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a disallowed type before any fetch happens", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      uploadBrandAsset({ briefId: "brief-1", file: fakeFile(1024, "image/gif") }),
    ).rejects.toThrow(/PNG, JPEG, or WebP/);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an SVG before any fetch happens, even though the bucket itself would allow it", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      uploadBrandAsset({ briefId: "brief-1", file: fakeFile(1024, "image/svg+xml") }),
    ).rejects.toThrow(/PNG, JPEG, or WebP/);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("uploadBrandAsset", () => {
  it("mints a ticket and PUTs to the returned signed URL for an accepted file", async () => {
    const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        path: "brief-1/uuid.png",
        token: "tok",
        signedUrl: "https://proj.supabase.co/storage/v1/object/upload/sign/xyz",
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", FakeXHR);

    const progress: number[] = [];
    const url = await uploadBrandAsset({
      briefId: "brief-1",
      file: realFile(1024),
      onProgress: (f) => progress.push(f),
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/assets/sign",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ briefId: "brief-1", contentType: "image/png" }),
      }),
    );
    expect(FakeXHR.instances).toHaveLength(1);
    expect(FakeXHR.instances[0].method).toBe("PUT");
    expect(FakeXHR.instances[0].url).toBe("https://proj.supabase.co/storage/v1/object/upload/sign/xyz");
    expect(FakeXHR.instances[0].headers["x-upsert"]).toBe("true");
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/public/brand-assets/brief-1/uuid.png");
    // Progress is reported at least at completion (1), even if the fake XHR never
    // fires an upload.onprogress event.
    expect(progress.at(-1)).toBe(1);

    process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  });

  it("surfaces the server's error message when signing fails", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Not your brief." }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      uploadBrandAsset({ briefId: "brief-1", file: fakeFile(1024) }),
    ).rejects.toThrow(/Not your brief\./);
  });
});
