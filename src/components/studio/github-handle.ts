// Shared client helper for the user's GitHub handle. Source of truth is the
// server profile; localStorage is the dev / no-auth fallback (Settings writes
// both). Keeps the handle logic identical across Settings, Connect, and header.

import { getProfileData } from "@/components/studio/profile-store";

export const HANDLE_KEY = "proof.githubHandle";

/** Resolve the saved GitHub handle: server profile first, then localStorage. */
export async function resolveHandle(): Promise<string | null> {
  // Reads through the shared profile store so repeated callers (header, connect
  // panel, settings) share a single /api/profile fetch.
  const profile = await getProfileData();
  const serverHandle = profile?.githubUsername ?? null;
  if (serverHandle) {
    try {
      window.localStorage.setItem(HANDLE_KEY, serverHandle);
    } catch {
      // ignore
    }
    return serverHandle;
  }
  try {
    return window.localStorage.getItem(HANDLE_KEY);
  } catch {
    return null;
  }
}
