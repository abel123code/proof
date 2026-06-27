import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { SUBTITLE, CAPTION } from "./tokens";
import { fontFamily } from "./fonts";
import type { Word } from "./types";

type Page = { startMs: number; endMs: number; words: Word[] };

// Page grouping: <=7 words / <=34 chars / 360ms gap flush. (Verbatim from Yoda.)
const groupWords = (words: Word[]): Page[] => {
  const pages: Page[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) {
      pages.push({ startMs: cur[0].startMs, endMs: cur[cur.length - 1].endMs, words: cur });
      cur = [];
    }
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    const gap = prev ? w.startMs - prev.endMs : 0;
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0);
    if (cur.length && (gap > CAPTION.gapFlushMs || chars > CAPTION.maxChars || cur.length >= CAPTION.maxWords)) {
      flush();
    }
    cur.push(w);
  }
  flush();
  // Keep each page up until the next begins — no flicker gaps.
  for (let i = 0; i < pages.length - 1; i++) pages[i].endMs = pages[i + 1].startMs;
  if (pages.length) pages[pages.length - 1].endMs += 600;
  return pages;
};

export const AutoSubtitle: React.FC<{ words: Word[]; accent: string }> = ({ words, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  const pages = useMemo(() => groupWords(words), [words]);
  const page = pages.find((p) => ms >= p.startMs && ms < p.endMs);
  if (!page) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: SUBTITLE.bottomOffset,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        padding: "0 60px",
      }}
    >
      <div
        style={{
          background: SUBTITLE.bg,
          color: SUBTITLE.text,
          padding: `${SUBTITLE.padV}px ${SUBTITLE.padH}px`,
          borderRadius: SUBTITLE.radius,
          fontFamily,
          fontSize: SUBTITLE.fontSize,
          fontWeight: 600,
          lineHeight: 1.3,
          textAlign: "center",
          maxWidth: "90%",
          boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        }}
      >
        {page.words.map((w, i) => {
          const active = ms >= w.startMs && ms < w.endMs;
          return (
            <span key={i} style={{ color: active ? accent : SUBTITLE.text }}>
              {w.text.trim()}
              {i < page.words.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
};
