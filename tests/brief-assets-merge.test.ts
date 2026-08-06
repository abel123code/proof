import { describe, expect, it, vi } from "vitest";

/**
 * setBriefAssets writes into the same `assets` jsonb column the render worker reads
 * brandVoice and motif off (see render/src/types.ts RenderAssets). It has to merge,
 * not overwrite: pins that property directly against the Supabase call, separate from
 * the route-level tests in brand-assets-route.test.ts, which mock @/lib/db wholesale
 * and so never exercise this merge logic. Mocks @/lib/supabase instead (same pattern
 * as tests/open-signup.test.ts) so the real setBriefAssets runs.
 */

let selectedRow: unknown = null;
let updatedWith: unknown = null;

function makeClient() {
  return {
    from(_table: string) {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: selectedRow, error: null });
      q.update = (values: unknown) => {
        updatedWith = values;
        return { eq: async () => ({ error: null }) };
      };
      return q;
    },
  };
}

vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => makeClient() }));

describe("setBriefAssets merges into the assets column", () => {
  // The worker reads brandVoice and motif off this same column. A future refactor
  // that writes { images, brandColor } wholesale instead of merging would strip
  // brand direction from every scene rendered after that point, with nothing
  // failing - the render would just quietly go generic again. This pins the merge.
  it("keeps brandVoice and motif untouched while replacing images", async () => {
    selectedRow = {
      assets: { brandVoice: "confident, technical", motif: "terminal green", images: ["old.png"] },
    };
    const { setBriefAssets } = await import("@/lib/db");

    await setBriefAssets("brief-1", { images: ["new-a.png", "new-b.png"], brandColor: "#d9ff45" });

    expect(updatedWith).toEqual({
      assets: {
        brandVoice: "confident, technical",
        motif: "terminal green",
        images: ["new-a.png", "new-b.png"],
        brandColor: "#d9ff45",
      },
    });
  });

  it("starts from an empty object when the column was never set, without throwing", async () => {
    selectedRow = { assets: null };
    const { setBriefAssets } = await import("@/lib/db");

    await expect(setBriefAssets("brief-1", { images: ["a.png"] })).resolves.toBeUndefined();
    expect(updatedWith).toEqual({ assets: { images: ["a.png"] } });
  });
});
