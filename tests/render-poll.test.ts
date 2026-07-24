import { describe, expect, it } from "vitest";
import { resolveRenderPoll } from "@/lib/render-poll";

describe("resolveRenderPoll", () => {
  it("keeps polling the requested job instead of returning a stale brief video", () => {
    expect(
      resolveRenderPoll({
        durable: {
          status: "processing",
          phase: "cutting",
          progress: 30,
          outputUrl: "https://storage.example/old.mp4",
          error: null,
        },
        persistedUrl: "https://storage.example/old.mp4?v=previous",
      }),
    ).toEqual({ status: "cutting", progress: 30 });
  });

  it("returns the requested job output only after durable completion", () => {
    expect(
      resolveRenderPoll({
        durable: {
          status: "done",
          phase: "done",
          progress: 100,
          outputUrl: "https://storage.example/new.mp4?v=current",
          error: null,
        },
        persistedUrl: "https://storage.example/old.mp4?v=previous",
      }),
    ).toEqual({
      status: "done",
      progress: 100,
      url: "https://storage.example/new.mp4?v=current",
    });
  });

  it("surfaces a durable failure instead of a persisted video", () => {
    expect(
      resolveRenderPoll({
        durable: {
          status: "error",
          phase: "error",
          progress: 100,
          outputUrl: null,
          error: "render failed",
        },
        persistedUrl: "https://storage.example/old.mp4?v=previous",
      }),
    ).toEqual({ status: "error", progress: 100, error: "render failed" });
  });
});
