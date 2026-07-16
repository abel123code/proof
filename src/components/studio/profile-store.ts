"use client";

import type { OnboardingState } from "@/lib/onboarding";

// Shared client-side cache for the user's profile (`/api/profile`). Before this,
// the header (twice), the project panel, and settings each fetched the same
// endpoint on every studio page load - 2-3 duplicate round-trips, each of which
// re-authenticates and re-queries the DB server-side. This dedupes them to a
// single in-flight fetch, caches the result, and lets any consumer subscribe to
// updates (e.g. after a charged action moves the credit balance).

export interface ProfileData {
  githubUsername: string | null;
  email: string | null;
  isAdmin: boolean;
  creditsRemaining: number | null;
  creditsTotal: number | null;
  renderCost: number | null;
  onboardingState: OnboardingState;
  onboardingVersion: number;
  onboardingCompletedAt: string | null;
}

// Minimal repo shape used by the connect picker; cached here so returning to
// /connect doesn't re-hit GitHub.
export interface PublicRepo {
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  pushedAt: string | null;
}

let cache: ProfileData | null = null;
let inflight: Promise<ProfileData | null> | null = null;
const subscribers = new Set<(d: ProfileData | null) => void>();

async function fetchProfile(): Promise<ProfileData | null> {
  try {
    const res = await fetch("/api/profile");
    if (!res.ok) return null;
    const d = await res.json();
    return {
      githubUsername: d?.githubUsername ?? null,
      email: d?.email ?? null,
      isAdmin: Boolean(d?.isAdmin),
      creditsRemaining: typeof d?.creditsRemaining === "number" ? d.creditsRemaining : null,
      creditsTotal: typeof d?.creditsTotal === "number" ? d.creditsTotal : null,
      renderCost: typeof d?.renderCost === "number" ? d.renderCost : null,
      onboardingState:
        d?.onboardingState === "completed" || d?.onboardingState === "skipped"
          ? d.onboardingState
          : "not_started",
      onboardingVersion:
        typeof d?.onboardingVersion === "number" ? d.onboardingVersion : 1,
      onboardingCompletedAt:
        typeof d?.onboardingCompletedAt === "string" ? d.onboardingCompletedAt : null,
    };
  } catch {
    return null;
  }
}

function notify(): void {
  for (const cb of subscribers) cb(cache);
}

/**
 * Resolve the profile, sharing a single fetch. Returns the cached value if
 * present, joins an in-flight request if one is pending, otherwise fetches.
 */
export function getProfileData(): Promise<ProfileData | null> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetchProfile().then((d) => {
    inflight = null;
    if (d) {
      cache = d;
      notify();
    }
    return d;
  });
  return inflight;
}

/** Force a re-fetch (e.g. after a charged action) and notify subscribers. */
export function refreshProfile(): Promise<ProfileData | null> {
  inflight = fetchProfile().then((d) => {
    inflight = null;
    cache = d;
    notify();
    return d;
  });
  return inflight;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Coalesce bursty refresh triggers (focus, visibility, route change). */
export function refreshProfileDebounced(delay = 500): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void refreshProfile();
  }, delay);
}

/**
 * Subscribe to profile changes. Fires immediately with the current cache if one
 * exists. Returns an unsubscribe function.
 */
export function subscribeProfile(cb: (d: ProfileData | null) => void): () => void {
  subscribers.add(cb);
  if (cache) cb(cache);
  return () => {
    subscribers.delete(cb);
  };
}

// --- GitHub repo list cache (per handle) ------------------------------------

let repoCache: { handle: string; repos: PublicRepo[] } | null = null;

export function getCachedRepos(handle: string): PublicRepo[] | null {
  return repoCache && repoCache.handle === handle ? repoCache.repos : null;
}

export function setCachedRepos(handle: string, repos: PublicRepo[]): void {
  repoCache = { handle, repos };
}
