import { describe, expect, it } from "vitest";
import { normalizeUiRecord, MAX_UI_ITEMS } from "@/lib/ui-record";

/**
 * The record is the only thing standing between a screenshot and an invented course code, so
 * these tests care most about what it REFUSES to carry: unreadable text must arrive marked, and
 * a model that stays silent about legibility must not be read as having vouched for the text.
 */
describe("normalizeUiRecord", () => {
  it("keeps verbatim legible text and trims surrounding space", () => {
    expect(
      normalizeUiRecord({ items: [{ text: "  Homework 1 ", region: "list", legible: true }] }),
    ).toEqual({ items: [{ text: "Homework 1", region: "list", legible: true }] });
  });

  it("drops empty and whitespace-only strings", () => {
    const out = normalizeUiRecord({
      items: [
        { text: "", region: "list", legible: true },
        { text: "   ", region: "list", legible: true },
        { text: "Due Dates", region: "header", legible: true },
      ],
    });
    expect(out?.items).toEqual([{ text: "Due Dates", region: "header", legible: true }]);
  });

  it("keeps illegible items but marks them, so the author can omit rather than guess", () => {
    const out = normalizeUiRecord({ items: [{ text: "10.0??", region: "list", legible: false }] });
    expect(out?.items[0].legible).toBe(false);
  });

  it("treats a missing or non-boolean legible flag as illegible", () => {
    // Silence is not permission: a model that did not assert it could read the text has not.
    expect(normalizeUiRecord({ items: [{ text: "Homework 1", region: "list" }] })?.items[0].legible).toBe(false);
    expect(
      normalizeUiRecord({ items: [{ text: "Homework 1", region: "list", legible: "yes" }] })?.items[0].legible,
    ).toBe(false);
  });

  it("dedupes identical text in the same region", () => {
    const out = normalizeUiRecord({
      items: [
        { text: "Homework 1", region: "list", legible: true },
        { text: "Homework 1", region: "list", legible: true },
      ],
    });
    expect(out?.items).toHaveLength(1);
  });

  it("keeps the same text when it appears in different regions", () => {
    const out = normalizeUiRecord({
      items: [
        { text: "Homework 1", region: "header", legible: true },
        { text: "Homework 1", region: "list", legible: true },
      ],
    });
    expect(out?.items).toHaveLength(2);
  });

  it("drops a paragraph, which means the model summarised instead of reading", () => {
    const out = normalizeUiRecord({
      items: [
        { text: "x".repeat(400), region: "list", legible: true },
        { text: "Due Dates", region: "header", legible: true },
      ],
    });
    expect(out?.items).toEqual([{ text: "Due Dates", region: "header", legible: true }]);
  });

  it("caps the item count so one screenshot cannot flood the author prompt", () => {
    const many = Array.from({ length: MAX_UI_ITEMS + 25 }, (_, i) => ({
      text: `row ${i}`,
      region: "list",
      legible: true,
    }));
    expect(normalizeUiRecord({ items: many })?.items).toHaveLength(MAX_UI_ITEMS);
  });

  it("returns null for junk rather than throwing into the upload path", () => {
    expect(normalizeUiRecord(null)).toBeNull();
    expect(normalizeUiRecord(undefined)).toBeNull();
    expect(normalizeUiRecord({})).toBeNull();
    expect(normalizeUiRecord({ items: "nope" })).toBeNull();
    expect(normalizeUiRecord({ items: [] })).toBeNull();
    expect(normalizeUiRecord({ items: [{ notText: 1 }] })).toBeNull();
  });
});
