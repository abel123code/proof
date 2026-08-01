import { describe, expect, it, vi, afterEach } from "vitest";
import { MAX_CLIP_BYTES, tooLargeMessage, uploadSceneFootageDirect } from "@/lib/upload";

/**
 * Supabase caps a single upload at 50MB on the current plan (51MB is rejected with a 413,
 * 50MB is accepted). Before this, an oversized clip uploaded in full and then failed with
 * "Upload failed (413)" — no size, no limit, nothing the user could act on.
 */

const fakeFile = (bytes: number) => ({ size: bytes, type: "video/mp4" }) as Blob;

afterEach(() => vi.unstubAllGlobals());

describe("tooLargeMessage", () => {
  it("states the limit and the two things the user can do", () => {
    expect(tooLargeMessage()).toBe(
      "That clip is over the 50MB upload limit. Record a shorter take or compress it.",
    );
  });

  it("says nothing about plans or storage, which the user cannot act on", () => {
    // An earlier draft told users to "upgrade storage". That is the project owner's
    // Supabase plan; a person recording a video has no way to change it.
    expect(tooLargeMessage()).not.toMatch(/upgrade|plan|supabase|quota|storage/i);
  });
});

describe("uploadSceneFootageDirect", () => {
  it("rejects an oversized clip before spending a single byte of upload", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      uploadSceneFootageDirect({ briefId: "b1", sceneIndex: 0, file: fakeFile(MAX_CLIP_BYTES + 1) }),
    ).rejects.toThrow(/over the 50MB upload limit/);

    // The point of checking first: no ticket minted, no PUT, no progress bar crawling for
    // minutes on a dorm connection before failing.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lets a clip exactly on the limit through to the upload path", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "stop here, the size check already passed" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      uploadSceneFootageDirect({ briefId: "b1", sceneIndex: 0, file: fakeFile(MAX_CLIP_BYTES) }),
    ).rejects.toThrow(/stop here/);

    // Off-by-one guard: 50MB exactly is accepted by Supabase, so it must not be blocked.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
