import { describe, expect, it } from "vitest";
import { decideSubmission } from "@/lib/render-submit";

describe("decideSubmission", () => {
  it("starts a new job when nothing is in flight", () => {
    expect(decideSubmission(null)).toEqual({ action: "start" });
  });

  it("reuses a queued job instead of charging again", () => {
    expect(decideSubmission({ id: "job-1", status: "queued" })).toEqual({
      action: "reuse",
      jobId: "job-1",
    });
  });

  it("reuses a processing job", () => {
    expect(decideSubmission({ id: "job-2", status: "processing" })).toEqual({
      action: "reuse",
      jobId: "job-2",
    });
  });

  it("starts fresh when the previous attempt finished", () => {
    expect(decideSubmission({ id: "job-3", status: "done" })).toEqual({ action: "start" });
  });

  it("allows a retry after a failure", () => {
    // A failed render is a legitimate thing to retry, so this must not be blocked.
    expect(decideSubmission({ id: "job-4", status: "error" })).toEqual({ action: "start" });
  });

  it("treats an unrecognised status as terminal rather than blocking the user", () => {
    // Fail toward letting the user render. Blocking on a status we do not know
    // would strand them with no way to proceed.
    expect(decideSubmission({ id: "job-5", status: "something-new" })).toEqual({ action: "start" });
  });
});
