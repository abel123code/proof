import { describe, expect, it, vi } from "vitest";
import {
  discardActiveRecording,
  shouldHandleGlobalPlaybackShortcut,
} from "../src/components/studio/teleprompter";

describe("inline teleprompter controls", () => {
  it("keeps the global Space shortcut modal-only", () => {
    expect(shouldHandleGlobalPlaybackShortcut("modal", "Space")).toBe(true);
    expect(shouldHandleGlobalPlaybackShortcut("inline", "Space")).toBe(false);
    expect(shouldHandleGlobalPlaybackShortcut("modal", "Enter")).toBe(false);
  });

  it("discards an active partial recording before the recorder is closed", () => {
    const stop = vi.fn();
    const recorder = {
      state: "recording",
      ondataavailable: vi.fn(),
      onstop: vi.fn(),
      stop,
    } as unknown as MediaRecorder;
    const chunks = [new Blob(["partial take"])];

    discardActiveRecording(recorder, chunks);

    expect(recorder.ondataavailable).toBeNull();
    expect(recorder.onstop).toBeNull();
    expect(stop).toHaveBeenCalledOnce();
    expect(chunks).toHaveLength(0);
  });
});
