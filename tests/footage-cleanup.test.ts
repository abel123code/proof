import { describe, expect, it } from "vitest";
import { decideFootageCleanup, drainFootage } from "@/lib/footage-cleanup";

const brief = (over = {}) => ({
  id: "brief-1",
  renderStatus: "done",
  renderUrl: "https://x.supabase.co/storage/v1/object/public/renders/out.mp4",
  footageCount: 3,
  ...over,
});

describe("decideFootageCleanup", () => {
  it("clears footage for a brief whose render finished", () => {
    expect(decideFootageCleanup([brief()])).toEqual(["brief-1"]);
  });

  it("keeps footage when the render failed, because that is when people retry", () => {
    expect(decideFootageCleanup([brief({ renderStatus: "error" })])).toEqual([]);
  });

  it("keeps footage while a render is still running", () => {
    expect(decideFootageCleanup([brief({ renderStatus: "processing" })])).toEqual([]);
    expect(decideFootageCleanup([brief({ renderStatus: "queued" })])).toEqual([]);
  });

  it("never clears footage for a video that does not exist", () => {
    // A brief marked done with no output URL is a broken render, not a finished one.
    expect(decideFootageCleanup([brief({ renderUrl: null })])).toEqual([]);
    expect(decideFootageCleanup([brief({ renderUrl: "" })])).toEqual([]);
  });

  it("skips briefs that have no footage left", () => {
    expect(decideFootageCleanup([brief({ footageCount: 0 })])).toEqual([]);
  });

  it("handles an unknown status by keeping the footage", () => {
    // Failing toward keeping data is the safe direction: worst case is wasted storage,
    // not a student losing takes we cannot regenerate.
    expect(decideFootageCleanup([brief({ renderStatus: "something-new" })])).toEqual([]);
    expect(decideFootageCleanup([brief({ renderStatus: null })])).toEqual([]);
  });

  it("picks only the qualifying briefs out of a mixed list", () => {
    const rows = [
      brief({ id: "a" }),
      brief({ id: "b", renderStatus: "error" }),
      brief({ id: "c" }),
      brief({ id: "d", footageCount: 0 }),
    ];
    expect(decideFootageCleanup(rows)).toEqual(["a", "c"]);
  });
});

describe("drainFootage", () => {
  it("forgets the clips only after storage confirms they are gone", async () => {
    const order: string[] = [];
    const res = await drainFootage(["brief-1"], {
      remove: async (id) => {
        order.push(`remove:${id}`);
      },
      forget: async (id) => {
        order.push(`forget:${id}`);
      },
    });
    // Removing first means a failure leaves a row we can retry from. The reverse
    // order loses the pointer and orphans the object with nothing tracking it.
    expect(order).toEqual(["remove:brief-1", "forget:brief-1"]);
    expect(res).toEqual({ cleared: 1, failed: [] });
  });

  it("does not forget the clips when the delete failed", async () => {
    const order: string[] = [];
    const res = await drainFootage(["brief-1"], {
      remove: async () => {
        throw new Error("storage down");
      },
      forget: async (id) => {
        order.push(`forget:${id}`);
      },
    });
    expect(order).toEqual([]);
    expect(res).toEqual({ cleared: 0, failed: ["brief-1"] });
  });

  it("keeps going after one brief fails", async () => {
    const res = await drainFootage(["a", "b"], {
      remove: async (id) => {
        if (id === "a") throw new Error("nope");
      },
      forget: async () => {},
    });
    expect(res).toEqual({ cleared: 1, failed: ["a"] });
  });
});
