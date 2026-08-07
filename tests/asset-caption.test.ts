import { describe, expect, it } from "vitest";
import {
  describeAssets,
  MAX_DESCRIPTION_CHARS,
  normalizeDescription,
  stagedFileName,
} from "@/lib/asset-caption";

const BASE = "https://x.supabase.co/storage/v1/object/public/brand-assets/brief-1";

describe("stagedFileName", () => {
  it("keys on the basename the worker will stage the file under", () => {
    expect(stagedFileName(`${BASE}/ad86358e-8426.jpg`)).toBe("ad86358e-8426.jpg");
  });

  it("ignores a cache-busting query string", () => {
    expect(stagedFileName(`${BASE}/shot.png?v=1786`)).toBe("shot.png");
  });

  it("uses the rasterised name for an svg, because that is what gets staged", () => {
    // The worker rasterises SVG to PNG before staging; keying by .svg would never match.
    expect(stagedFileName(`${BASE}/logo.svg`)).toBe("logo.png");
  });

  it("replaces characters the worker would rewrite", () => {
    expect(stagedFileName(`${BASE}/my shot(1).png`)).toBe("my_shot_1_.png");
  });
});

describe("normalizeDescription", () => {
  it("collapses whitespace to a single line", () => {
    expect(normalizeDescription("  a\n  b   c ")).toBe("a b c");
  });

  it("truncates a description that would drown the planner prompt", () => {
    const long = "x".repeat(MAX_DESCRIPTION_CHARS + 50);
    const out = normalizeDescription(long);
    expect(out.length).toBe(MAX_DESCRIPTION_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("describeAssets", () => {
  it("describes each image, keyed by staged filename", async () => {
    const out = await describeAssets([`${BASE}/a.png`, `${BASE}/b.jpg`], {
      describe: async (u) => (u.endsWith("a.png") ? "A deadline list" : "A course page"),
    });
    expect(out).toEqual({ "a.png": "A deadline list", "b.jpg": "A course page" });
  });

  it("does not re-describe an image that already has one", async () => {
    let calls = 0;
    const out = await describeAssets(
      [`${BASE}/a.png`],
      {
        describe: async () => {
          calls += 1;
          return "fresh";
        },
      },
      { "a.png": "already known" },
    );
    expect(calls).toBe(0);
    expect(out["a.png"]).toBe("already known");
  });

  it("drops a failed caption rather than failing the upload", async () => {
    // A caption failure must not block the asset. The planner reads a missing entry as
    // "unknown" and will not treat the image as proof of a claim, which is the safe default.
    const out = await describeAssets([`${BASE}/a.png`, `${BASE}/b.png`], {
      describe: async (u) => {
        if (u.endsWith("a.png")) throw new Error("vision down");
        return "A settings screen";
      },
    });
    expect(out).toEqual({ "b.png": "A settings screen" });
  });

  it("returns the existing map unchanged when there is nothing to describe", async () => {
    const out = await describeAssets([], { describe: async () => "x" }, { "a.png": "kept" });
    expect(out).toEqual({ "a.png": "kept" });
  });
});

describe("describeAssets concurrency", () => {
  it("describes images in parallel, not one after another", async () => {
    // Sequentially this was 26s for five images, inside the upload request. Asserting overlap
    // rather than wall-clock keeps the test honest on a slow machine.
    let inFlight = 0;
    let peak = 0;
    const urls = Array.from({ length: 5 }, (_, i) => `${BASE}/img-${i}.png`);
    await describeAssets(urls, {
      describe: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return "a screen";
      },
    });
    expect(peak).toBe(5);
  });

  it("asks once for an image listed twice", async () => {
    let calls = 0;
    const out = await describeAssets([`${BASE}/a.png`, `${BASE}/a.png`], {
      describe: async () => {
        calls += 1;
        return "a screen";
      },
    });
    expect(calls).toBe(1);
    expect(out).toEqual({ "a.png": "a screen" });
  });

  it("one failure does not lose the others", async () => {
    const out = await describeAssets([`${BASE}/a.png`, `${BASE}/b.png`, `${BASE}/c.png`], {
      describe: async (u) => {
        if (u.endsWith("b.png")) throw new Error("vision down");
        return "a screen";
      },
    });
    expect(Object.keys(out).sort()).toEqual(["a.png", "c.png"]);
  });
});
