"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  getProfileData,
  refreshProfile,
} from "@/components/studio/profile-store";
import {
  ONBOARDING_EVENT,
  type OnboardingAction,
} from "@/components/studio/onboarding-events";
import {
  ONBOARDING_VERSION,
  shouldAutoStartOnboarding,
  type OnboardingState,
} from "@/lib/onboarding";

const SESSION_KEY = "proof:onboarding-tour-step";
const SESSION_MODE_KEY = "proof:onboarding-tour-mode";
const LOCAL_STATUS_PREFIX = "proof:onboarding-status:";

type TourMode = "auto" | "replay";

const TOUR_STEPS = [
  "welcome",
  "settings-nav",
  "github",
  "pick-repo",
  "repo-search",
  "repo-select",
  "analysis",
  "continue",
] as const;

type TourStep = (typeof TOUR_STEPS)[number];

type StepDefinition = {
  title: string;
  body: string;
  target?: string;
  waiting?: boolean;
};

const STEP_DEFINITIONS: Record<TourStep, StepDefinition> = {
  welcome: {
    title: "Let’s create your first video",
    body: "Connect GitHub, find the project you want to promote, and start Proof’s research flow.",
  },
  "settings-nav": {
    title: "Connect your GitHub",
    body: "Open Settings so Proof can load the public repositories on your account.",
    target: "settings-link",
  },
  github: {
    title: "Save your GitHub handle",
    body: "Enter your username or profile URL, then save it. If it is already correct, save it again to continue.",
    target: "github-connect",
  },
  "pick-repo": {
    title: "Return to your repositories",
    body: "Your GitHub account is connected. Continue to the repository picker.",
    target: "pick-repo-link",
  },
  "repo-search": {
    title: "Find your project",
    body: "Search by repository name or description to narrow the list.",
    target: "repo-search",
  },
  "repo-select": {
    title: "Choose the repository",
    body: "Select the project you want Proof to turn into a video.",
    target: "repo-select",
  },
  analysis: {
    title: "Proof is reading the repo",
    body: "We’re scanning the README, stack, and structure. This step advances automatically when analysis finishes.",
    target: "repo-list",
    waiting: true,
  },
  continue: {
    title: "Start the content flow",
    body: "Continue to research. Proof will find relevant trends and help shape the strongest angle.",
    target: "next-stage",
  },
};

function isTourStep(value: string | null): value is TourStep {
  return TOUR_STEPS.includes(value as TourStep);
}

function loadSessionStep(): TourStep | null {
  try {
    const value = window.sessionStorage.getItem(SESSION_KEY);
    return isTourStep(value) ? value : null;
  } catch {
    return null;
  }
}

function saveSessionStep(step: TourStep | null): void {
  try {
    if (step) window.sessionStorage.setItem(SESSION_KEY, step);
    else {
      window.sessionStorage.removeItem(SESSION_KEY);
      window.sessionStorage.removeItem(SESSION_MODE_KEY);
    }
  } catch {
    // Session persistence is a convenience; the active in-memory tour still works.
  }
}

function loadSessionMode(): TourMode {
  try {
    return window.sessionStorage.getItem(SESSION_MODE_KEY) === "replay" ? "replay" : "auto";
  } catch {
    return "auto";
  }
}

function saveSessionMode(mode: TourMode): void {
  try {
    window.sessionStorage.setItem(SESSION_MODE_KEY, mode);
  } catch {
    // The in-memory mode remains authoritative for the current page.
  }
}

function hasLocalCompletion(identity: string): boolean {
  try {
    const raw = window.localStorage.getItem(`${LOCAL_STATUS_PREFIX}${identity}`);
    if (!raw) return false;
    const saved = JSON.parse(raw) as { state?: OnboardingState; version?: number };
    return (
      (saved.state === "completed" || saved.state === "skipped") &&
      typeof saved.version === "number" &&
      saved.version >= ONBOARDING_VERSION
    );
  } catch {
    return false;
  }
}

function saveLocalCompletion(identity: string, state: Exclude<OnboardingState, "not_started">): void {
  try {
    window.localStorage.setItem(
      `${LOCAL_STATUS_PREFIX}${identity}`,
      JSON.stringify({ state, version: ONBOARDING_VERSION }),
    );
  } catch {
    // Server persistence remains authoritative when local storage is unavailable.
  }
}

function previousStep(step: TourStep): TourStep | null {
  const index = TOUR_STEPS.indexOf(step);
  return index > 0 ? TOUR_STEPS[index - 1] : null;
}

const subscribeToHydration = () => () => {};

export function OnboardingTour() {
  const pathname = usePathname();
  const router = useRouter();
  const [step, setStepState] = useState<TourStep | null>(null);
  const [mode, setMode] = useState<TourMode>("auto");
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const mounted = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const cardRef = useRef<HTMLDivElement>(null);
  const profileIdentityRef = useRef("dev");

  const setStep = useCallback((next: TourStep | null) => {
    saveSessionStep(next);
    setConfirmSkip(false);
    setStepState(next);
  }, []);

  const persistState = useCallback(async (state: Exclude<OnboardingState, "not_started">) => {
    saveLocalCompletion(profileIdentityRef.current, state);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingState: state }),
      });
      if (res.ok) void refreshProfile();
    } catch {
      // The session still closes even if persistence is temporarily unavailable.
    }
  }, []);

  const finish = useCallback(() => {
    if (mode === "auto") void persistState("completed");
    setStep(null);
  }, [mode, persistState, setStep]);

  const skip = useCallback(() => {
    if (mode === "auto") void persistState("skipped");
    setStep(null);
  }, [mode, persistState, setStep]);

  const start = useCallback(() => {
    setMode("replay");
    saveSessionMode("replay");
    setStep("welcome");
    if (pathname !== "/connect") router.push("/connect");
  }, [pathname, router, setStep]);

  useEffect(() => {
    const saved = loadSessionStep();
    if (saved) {
      const savedMode = loadSessionMode();
      queueMicrotask(() => {
        setMode(savedMode);
        setStepState(saved);
      });
    }

    void getProfileData().then((data) => {
      const identity = data?.email ?? "dev";
      profileIdentityRef.current = identity;
      if (
        !saved &&
        data &&
        !hasLocalCompletion(identity) &&
        shouldAutoStartOnboarding(data.onboardingState, data.onboardingVersion)
      ) {
        setMode("auto");
        saveSessionMode("auto");
        setStep("welcome");
        if (pathname !== "/connect") router.push("/connect");
      }
    });
  }, [pathname, router, setStep]);

  useEffect(() => {
    const handleReplay = () => start();
    window.addEventListener("proof:replay-onboarding", handleReplay);
    return () => window.removeEventListener("proof:replay-onboarding", handleReplay);
  }, [start]);

  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (step === "settings-nav" && pathname === "/settings") setStep("github");
      if (step === "pick-repo" && pathname === "/connect") setStep("repo-search");
      if (step === "continue" && pathname === "/research") finish();
    });
    return () => {
      cancelled = true;
    };
  }, [finish, pathname, setStep, step]);

  useEffect(() => {
    const onAction = (event: Event) => {
      const action = (event as CustomEvent<OnboardingAction>).detail;
      if (step === "github" && action === "github-saved") setStep("pick-repo");
      if (step === "repo-search" && action === "repo-searched") setStep("repo-select");
      if (step === "repo-select" && action === "repo-selected") setStep("analysis");
      if (step === "analysis" && action === "repo-analyzed") setStep("continue");
      if (step === "analysis" && action === "repo-analysis-failed") setStep("repo-select");
    };
    window.addEventListener(ONBOARDING_EVENT, onAction);
    return () => window.removeEventListener(ONBOARDING_EVENT, onAction);
  }, [setStep, step]);

  useEffect(() => {
    if (!step) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmSkip(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step]);

  useLayoutEffect(() => {
    if (!step || step === "welcome") return;

    const selector = STEP_DEFINITIONS[step].target;
    let frame = 0;
    let observer: ResizeObserver | null = null;
    let target: HTMLElement | null = null;

    const update = () => {
      target = selector
        ? document.querySelector<HTMLElement>(`[data-tour="${selector}"]`)
        : null;
      if (!target) {
        setTargetRect(null);
        return;
      }

      const rect = target.getBoundingClientRect();
      const visible = rect.top >= 16 && rect.bottom <= window.innerHeight - 16;
      if (!visible) target.scrollIntoView({ behavior: "smooth", block: "center" });
      setTargetRect(target.getBoundingClientRect());

      observer?.disconnect();
      observer = new ResizeObserver(() => setTargetRect(target?.getBoundingClientRect() ?? null));
      observer.observe(target);
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    update();
    const interval = window.setInterval(update, 350);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [step]);

  useEffect(() => {
    if (step === "welcome") cardRef.current?.focus();
  }, [step]);

  const goBack = useCallback(() => {
    if (!step) return;
    const previous = previousStep(step);
    if (!previous) return;
    setStep(previous);
    if (previous === "settings-nav") router.push("/connect");
    if (previous === "github" || previous === "pick-repo") router.push("/settings");
    if (previous === "repo-search" || previous === "repo-select") router.push("/connect");
  }, [router, setStep, step]);

  if (!mounted || !step) return null;

  const definition = STEP_DEFINITIONS[step];
  const index = TOUR_STEPS.indexOf(step);
  const pad = 8;
  const visibleTargetRect = step === "welcome" ? null : targetRect;
  const rect = visibleTargetRect
    ? {
        left: Math.max(8, visibleTargetRect.left - pad),
        top: Math.max(8, visibleTargetRect.top - pad),
        right: Math.min(window.innerWidth - 8, visibleTargetRect.right + pad),
        bottom: Math.min(window.innerHeight - 8, visibleTargetRect.bottom + pad),
      }
    : null;
  const cardWidth = Math.min(360, window.innerWidth - 32);
  const cardLeft = rect
    ? Math.min(Math.max(16, rect.left), window.innerWidth - cardWidth - 16)
    : (window.innerWidth - cardWidth) / 2;
  const cardTop = rect
    ? rect.bottom + 220 < window.innerHeight
      ? rect.bottom + 14
      : Math.max(16, rect.top - 204)
    : Math.max(24, window.innerHeight / 2 - 150);

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100]" aria-live="polite">
      {rect ? (
        <>
          <div className="fixed left-0 right-0 top-0 bg-foreground/70" style={{ height: rect.top }} />
          <div className="fixed bottom-0 left-0 right-0 bg-foreground/70" style={{ top: rect.bottom }} />
          <div className="fixed left-0 bg-foreground/70" style={{ top: rect.top, width: rect.left, height: rect.bottom - rect.top }} />
          <div className="fixed right-0 bg-foreground/70" style={{ top: rect.top, left: rect.right, height: rect.bottom - rect.top }} />
          <div
            className="pointer-events-none fixed rounded-xl border-2 border-primary ring-4 ring-primary/25"
            style={{ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }}
          />
        </>
      ) : (
        <div className="fixed inset-0 bg-foreground/70" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-label="Proof product guide"
        tabIndex={-1}
        className="pointer-events-auto fixed rounded-xl border border-border bg-card p-5 text-card-foreground shadow-2xl outline-none"
        style={{ left: cardLeft, top: cardTop, width: cardWidth }}
      >
        {confirmSkip ? (
          <>
            <p className="font-display text-xl tracking-tight">Stop the guide?</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              You can replay it any time from the Guide button.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmSkip(false)}>Keep going</Button>
              <Button variant="destructive" onClick={skip}>Skip guide</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] text-primary">
                {step === "welcome" ? "Quick start" : `Step ${index} of ${TOUR_STEPS.length - 1}`}
              </span>
              <button
                type="button"
                onClick={() => setConfirmSkip(true)}
                className="rounded px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Skip
              </button>
            </div>
            <h2 className="mt-3 font-display text-2xl leading-tight tracking-tight">
              {definition.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {definition.body}
            </p>
            {definition.waiting && (
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
              </div>
            )}
            {!targetRect && step !== "welcome" && (
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                {step === "repo-select"
                  ? "No matching repo yet. Go Back and adjust your search."
                  : "Getting this step ready…"}
              </p>
            )}
            <div className="mt-5 flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                onClick={goBack}
                disabled={index === 0 || step === "analysis"}
              >
                Back
              </Button>
              {step === "welcome" ? (
                <Button onClick={() => setStep("settings-nav")}>Start demo</Button>
              ) : (
                <span className="text-right font-mono text-[10px] text-muted-foreground">
                  {definition.waiting ? "Working…" : "Use the highlighted control"}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ReplayOnboardingButton() {
  const replay = () => window.dispatchEvent(new Event("proof:replay-onboarding"));
  return (
    <button
      type="button"
      onClick={replay}
      title="Replay first-time guide"
      className="rounded-md px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Guide
    </button>
  );
}
