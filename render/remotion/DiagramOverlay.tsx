import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { INK } from "./tokens";
import { fontFamily, monoFamily } from "./fonts";
import type { OverlayCue } from "./types";

const FADE_MS = 280;

/** Big overlays: architecture diagram / image (rendered as <Img>) or a text card. */
export const DiagramOverlay: React.FC<{ cues: OverlayCue[]; accent: string }> = ({ cues, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  const active = cues.find((c) => ms >= c.startMs && ms < c.endMs);
  if (!active) return null;

  const opacity = interpolate(
    ms,
    [active.startMs, active.startMs + FADE_MS, active.endMs - FADE_MS, active.endMs],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const isImage = active.type === "image" || active.type === "architecture-diagram";

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity }}>
      {isImage ? (
        <div
          style={{
            background: "rgba(10, 14, 20, 0.9)",
            border: `2px solid ${accent}`,
            borderRadius: 18,
            padding: 24,
            maxWidth: "84%",
            maxHeight: "70%",
            boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          }}
        >
          <Img src={active.content} style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        </div>
      ) : (
        <div
          style={{
            background: "rgba(10, 14, 20, 0.92)",
            border: `2px solid ${accent}`,
            borderRadius: 18,
            padding: "40px 48px",
            maxWidth: "80%",
            boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ fontFamily: monoFamily, fontSize: 26, color: accent, marginBottom: 16, letterSpacing: 1 }}>
            {"// note"}
          </div>
          <div style={{ fontFamily, fontSize: 48, fontWeight: 700, color: INK, lineHeight: 1.25 }}>
            {active.content}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
