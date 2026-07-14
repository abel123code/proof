import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { SUBTITLE, CAPTION } from "./tokens";
import { fontFamily } from "./fonts";
import type { Word } from "./types";

type Page = { startMs: number; endMs: number; words: Word[] };

// Short phrase grouping keeps every spoken word while matching modern reel pacing.
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
    const punctuationBreak = prev ? /[.!?,:;]$/.test(prev.text.trim()) : false;
    if (
      cur.length &&
      (gap > CAPTION.gapFlushMs || punctuationBreak || chars > CAPTION.maxChars || cur.length >= CAPTION.maxWords)
    ) {
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
          fontWeight: 700,
          lineHeight: 1.3,
          textAlign: "center",
          maxWidth: "90%",
          boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        }}
      >
        {page.words.map((w, i) => {
          const active = ms >= w.startMs && ms < w.endMs;
          return (
            <span
              key={i}
              style={{
                color: active ? "#11151c" : w.emphasis ? accent : SUBTITLE.text,
                background: active ? accent : "transparent",
                borderRadius: active ? 8 : 0,
                padding: active ? "2px 7px 3px" : "2px 0 3px",
                marginRight: i < page.words.length - 1 ? 10 : 0,
                display: "inline-block",
                transform: `scale(${active ? (w.emphasis ? 1.12 : 1.06) : 1})`,
                transformOrigin: "center bottom",
              }}
            >
              {w.text.trim()}
            </span>
          );
        })}
      </div>
    </div>
  );
};
