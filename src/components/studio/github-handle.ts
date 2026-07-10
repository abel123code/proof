// Shared client helper for the user's GitHub handle. Source of truth is the
// server profile; localStorage is the dev / no-auth fallback (Settings writes
// both). Keeps the handle logic identical across Settings, Connect, and header.

export const HANDLE_KEY = "proof.githubHandle";

/** Resolve the saved GitHub handle: server profile first, then localStorage. */
export async function resolveHandle(): Promise<string | null> {
  let serverHandle: string | null = null;
  try {
    const res = await fetch("/api/profile");
    if (res.ok) {
      const data = await res.json();
      serverHandle = data?.githubUsername ?? null;
    }
  } catch {
    // ignore - fall back to localStorage
  }
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
