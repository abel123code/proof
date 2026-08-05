import { describe, expect, it } from "vitest";
import { decideSubmission } from "@/lib/render-submit";

const NOW = Date.parse("2026-08-06T12:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

describe("decideSubmission", () => {
  it("starts a new job when nothing is in flight", () => {
    expect(decideSubmission(null, NOW)).toEqual({ action: "start" });
  });

  it("reuses a queued job instead of charging again", () => {
    expect(
      decideSubmission({ id: "job-1", status: "queued", updatedAt: minutesAgo(1) }, NOW),
    ).toEqual({
      action: "reuse",
      jobId: "job-1",
    });
  });

  it("reuses a processing job", () => {
    expect(
      decideSubmission({ id: "job-2", status: "processing", updatedAt: minutesAgo(1) }, NOW),
    ).toEqual({
      action: "reuse",
      jobId: "job-2",
    });
  });

  it("starts fresh when the previous attempt finished", () => {
    expect(
      decideSubmission({ id: "job-3", status: "done", updatedAt: minutesAgo(1) }, NOW),
    ).toEqual({ action: "start" });
  });

  it("allows a retry after a failure", () => {
    // A failed render is a legitimate thing to retry, so this must not be blocked.
    expect(
      decideSubmission({ id: "job-4", status: "error", updatedAt: minutesAgo(1) }, NOW),
    ).toEqual({ action: "start" });
  });

  it("treats an unrecognised status as terminal rather than blocking the user", () => {
    // Fail toward letting the user render. Blocking on a status we do not know
    // would strand them with no way to proceed.
    expect(
      decideSubmission({ id: "job-5", status: "something-new", updatedAt: minutesAgo(1) }, NOW),
    ).toEqual({ action: "start" });
  });

  it("reuses a job that is still being worked on", () => {
    expect(
      decideSubmission({ id: "job-6", status: "processing", updatedAt: minutesAgo(2) }, NOW),
    ).toEqual({ action: "reuse", jobId: "job-6" });
  });

  it("does not reuse a job the worker abandoned", () => {
    // durable.ts gives up after 3 attempts and never writes a terminal status, so a
    // crashed job sits in `processing` forever. Without a staleness cutoff that row
    // would block this brief from ever rendering again.
    expect(
      decideSubmission({ id: "job-7", status: "processing", updatedAt: minutesAgo(90) }, NOW),
    ).toEqual({ action: "start" });
  });

  it("does not reuse a job with no timestamp at all", () => {
    // A missing timestamp cannot be proven fresh, so it must not block the user.
    expect(
      decideSubmission({ id: "job-8", status: "queued", updatedAt: null }, NOW),
    ).toEqual({ action: "start" });
  });

  it("does not reuse a job with an unparseable timestamp", () => {
    expect(
      decideSubmission({ id: "job-9", status: "queued", updatedAt: "not-a-date" }, NOW),
    ).toEqual({ action: "start" });
  });
});
