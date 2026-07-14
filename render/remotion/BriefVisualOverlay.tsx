import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamily, monoFamily } from "./fonts";
import type { VisualCue } from "./types";

const labels: Partial<Record<VisualCue["template"], string>> = {
  metric: "THE NUMBER",
  comparison: "BEFORE → AFTER",
  steps: "THE FLOW",
  quote: "REAL TALK",
  payoff: "THE PAYOFF",
};

export const BriefVisualOverlay: React.FC<{ cues: VisualCue[]; accent: string }> = ({ cues, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const cue = cues.find((candidate) => ms >= candidate.startMs && ms < candidate.endMs);
  if (!cue) return null;

  const localFrame = frame - (cue.startMs / 1000) * fps;
  const enter = spring({ frame: localFrame, fps, config: { damping: 15, stiffness: 130 } });
  const remaining = cue.endMs - ms;
  const exit = remaining < 220 ? remaining / 220 : 1;
  const scale = interpolate(enter, [0, 1], [0.92, 1]);
  const translate = interpolate(enter, [0, 1], [30, 0]);
  const isHero = cue.template === "hook" || cue.template === "payoff";

  return (
    <div
      style={{
        position: "absolute",
        display: "flex",
        flexDirection: "column",
        top: "5%",
        left: "5%",
        right: "5%",
        alignItems: "center",
        opacity: Math.max(0, enter * exit),
        transform: `translateY(${translate}px) scale(${scale})`,
      }}
    >
      <div
        style={{
          width: "fit-content",
          maxWidth: "92%",
          minWidth: isHero ? "58%" : "42%",
          borderRadius: isHero ? 30 : 24,
          padding: isHero ? "32px 44px 36px" : "26px 36px 30px",
          background: isHero
            ? "linear-gradient(135deg, rgba(8,12,18,.94), rgba(20,25,34,.88))"
            : "rgba(8,12,18,.9)",
          border: `2px solid ${accent}`,
          boxShadow: `0 18px 55px rgba(0,0,0,.48), 0 0 30px ${accent}33`,
          textAlign: "center",
        }}
      >
        {labels[cue.template] ? (
          <div
            style={{
              fontFamily: monoFamily,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 2.5,
              color: accent,
              marginBottom: 10,
            }}
          >
            {labels[cue.template]}
          </div>
        ) : null}
        <div
          style={{
            fontFamily,
            fontSize: isHero ? 70 : cue.template === "metric" ? 66 : 58,
            fontWeight: 800,
            lineHeight: 1.03,
            letterSpacing: -1.8,
            color: "#fff",
            textWrap: "balance",
          }}
        >
          {cue.headline}
        </div>
        <div
          style={{
            height: 6,
            width: `${Math.round(enter * 100)}%`,
            maxWidth: 260,
            borderRadius: 999,
            margin: "18px auto 0",
            background: accent,
          }}
        />
      </div>
    </div>
  );
};
