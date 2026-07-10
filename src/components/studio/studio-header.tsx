"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { STAGES, stageIndex } from "@/components/studio/stages";
import { resolveHandle } from "@/components/studio/github-handle";
import { onCreditsChanged } from "@/components/studio/credits";

export function StudioHeader() {
  const pathname = usePathname();
  const current = stageIndex(pathname);
  const [handle, setHandle] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);

  const refreshCredits = useCallback(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setIsAdmin(Boolean(d.isAdmin));
        setCredits(typeof d.creditsRemaining === "number" ? d.creditsRemaining : null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    resolveHandle().then(setHandle);
  }, []);

  // Keep the balance authoritative: re-fetch on route change, on an explicit
  // credits:changed signal from a charged action, and when the tab regains focus.
  useEffect(() => {
    refreshCredits();
    const unsubscribe = onCreditsChanged(refreshCredits);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshCredits();
    };
    window.addEventListener("focus", refreshCredits);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refreshCredits);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname, refreshCredits]);

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-8 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/connect" className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary/12 font-mono text-sm font-bold text-primary">
            P
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Proof
          </span>
        </Link>

        <nav className="flex items-center">
          {STAGES.map((stage, i) => {
            const active = i === current;
            const done = current > i && current !== -1;

            const inner = (
              <>
                <span
                  className={`flex size-6 items-center justify-center rounded-full border font-mono text-[11px] transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : done
                        ? "border-primary/50 text-primary"
                        : "border-border text-muted-foreground"
                  }`}
                >
                  {done ? "✓" : stage.n}
                </span>
                <span
                  className={`hidden font-mono text-xs sm:inline ${
                    active ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {stage.label}
                </span>
              </>
            );

            return (
              <div key={stage.href} className="flex items-center">
                {i > 0 && (
                  <span
                    className={`mx-1.5 h-px w-4 sm:w-6 ${
                      done ? "bg-primary/40" : "bg-border"
                    }`}
                  />
                )}
                {stage.enabled ? (
                  <Link
                    href={stage.href}
                    title={stage.label}
                    className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-secondary"
                  >
                    {inner}
                  </Link>
                ) : (
                  <span
                    aria-disabled
                    title={`${stage.label} - coming soon`}
                    className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1 opacity-40"
                  >
                    {inner}
                  </span>
                )}
              </div>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          {credits !== null && (
            <span
              title="Credits remaining"
              className={`rounded-md px-2 py-1 font-mono text-[11px] ${
                credits <= 0 ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {credits} credits
            </span>
          )}
          {isAdmin && (
            <Link
              href="/admin"
              title="Admin"
              className="rounded-md px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Admin
            </Link>
          )}
          <Link
            href="/settings"
            title="Settings"
            className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <span className="hidden sm:inline">Settings</span>
            {handle && <span className="text-foreground">@{handle}</span>}
          </Link>
        </div>
      </div>
    </header>
  );
}
