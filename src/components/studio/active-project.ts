// Tracks the project the user is currently working on so navigation (the header
// stepper) can keep the ?project= context across stages. Backed by localStorage
// so it survives reloads within the same browser; the connect "Resume" list is
// the DB-backed source of truth for cross-device.

export interface ActiveProject {
  id: string;
  name: string | null;
}

const KEY = "proof.activeProject";
const CHANGED = "active-project:changed";

let cache: ActiveProject | null | undefined;

function read(): ActiveProject | null {
  if (typeof window === "undefined") return null;
  if (cache !== undefined) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as ActiveProject) : null;
  } catch {
    cache = null;
  }
  return cache;
}

export function getActiveProject(): ActiveProject | null {
  return read();
}

/** Set the current project. No-op if it already matches (avoids redundant events). */
export function setActiveProject(project: ActiveProject): void {
  if (typeof window === "undefined" || !project?.id) return;
  const current = read();
  if (current && current.id === project.id && current.name === project.name) return;
  cache = project;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(project));
  } catch {
    // ignore quota / privacy-mode failures
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function clearActiveProject(): void {
  if (typeof window === "undefined") return;
  cache = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Subscribe to active-project changes. Returns an unsubscribe fn. */
export function subscribeActiveProject(cb: (p: ActiveProject | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb(read());
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
}
