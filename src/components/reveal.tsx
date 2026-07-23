"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Fades its children up into view once, when they scroll into the viewport. Pairs with the `.reveal`
 * / `.is-visible` CSS in globals.css. `delayMs` staggers siblings via the `--stagger` custom property.
 * Reduced-motion users see the content immediately (the CSS disables the transition).
 */
export function Reveal({
  children,
  className = "",
  delayMs = 0,
  style,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`}
      style={{ ...(delayMs ? ({ "--stagger": `${delayMs}ms` } as CSSProperties) : {}), ...style }}
    >
      {children}
    </div>
  );
}
