import React from "react";
import { useCurrentFrame, useVideoConfig, spring } from "remotion";
import { INK } from "./tokens";
import { monoFamily } from "./fonts";
import type { KeywordCue } from "./types";

/** Animated mono "chip" that pops in when a flagged keyword is spoken. */
export const KeywordOverlay: React.FC<{ cues: KeywordCue[]; accent: string }> = ({ cues, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  const active = cues.find((c) => ms >= c.startMs && ms < c.endMs);
  if (!active) return null;

  const localFrame = frame - (active.startMs / 1000) * fps;
  const enter = spring({ frame: localFrame, fps, config: { damping: 14, stiffness: 120 } });
  const remainMs = active.endMs - ms;
  const exit = remainMs < 250 ? Math.max(0, remainMs / 250) : 1;
  const opacity = enter * exit;
  const translateY = (1 - enter) * 24;

  return (
    <div
      style={{
        position: "absolute",
        top: "16%",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          fontFamily: monoFamily,
          fontSize: 38,
          fontWeight: 600,
          color: INK,
          background: "rgba(10, 14, 20, 0.82)",
          border: `2px solid ${accent}`,
          borderRadius: 12,
          padding: "12px 24px",
          letterSpacing: 0.5,
          boxShadow: `0 0 24px ${accent}66`,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ color: accent }}>{"//"}</span>
        {active.phrase}
      </div>
    </div>
  );
};
