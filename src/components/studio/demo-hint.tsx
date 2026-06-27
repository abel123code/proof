import type { ReactNode } from "react";

// A big, in-flow demo instruction banner (used in place of a popup so it stays
// visible without blocking the screen). Only rendered in demo mode by callers.
export function DemoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 flex items-center gap-4 rounded-xl border-2 border-primary bg-primary/5 p-5">
      <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary-foreground">
        Demo
      </span>
      <p className="font-display text-2xl leading-tight tracking-tight sm:text-3xl">
        {children}
      </p>
    </div>
  );
}
