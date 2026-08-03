import { describe, expect, it } from "vitest";
import { sanitizeBugReport, MAX_BUG_MESSAGE } from "@/lib/bug-report";

describe("sanitizeBugReport", () => {
  it("rejects an empty or whitespace-only message", () => {
    expect(sanitizeBugReport({})).toBeNull();
    expect(sanitizeBugReport({ message: "   " })).toBeNull();
    expect(sanitizeBugReport({ message: 42 })).toBeNull();
  });

  it("trims the message and caps its length", () => {
    expect(sanitizeBugReport({ message: "  it broke  " })?.message).toBe("it broke");
    const long = "x".repeat(MAX_BUG_MESSAGE + 500);
    expect(sanitizeBugReport({ message: long })?.message).toHaveLength(MAX_BUG_MESSAGE);
  });

  it("keeps only known context keys, trimmed", () => {
    const out = sanitizeBugReport({
      message: "graphics on my face",
      context: {
        briefId: " abc-123 ",
        renderJobId: "job-9",
        lastError: "ffmpeg exited 1",
        evil: "drop table",
        nested: { a: 1 },
      },
    });
    expect(out?.context).toEqual({
      briefId: "abc-123",
      renderJobId: "job-9",
      lastError: "ffmpeg exited 1",
    });
  });

  it("tolerates a missing or non-object context", () => {
    expect(sanitizeBugReport({ message: "hi" })?.context).toEqual({});
    expect(sanitizeBugReport({ message: "hi", context: "nope" })?.context).toEqual({});
  });

  it("drops blank context values rather than storing empty strings", () => {
    const out = sanitizeBugReport({ message: "hi", context: { briefId: "  ", url: "/brief" } });
    expect(out?.context).toEqual({ url: "/brief" });
  });
});
