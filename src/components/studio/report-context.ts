// Diagnostic breadcrumbs for the "report a bug" dialog.
//
// The header widget lives outside BriefPanel, so the ids that make a report
// actionable (briefId, renderJobId, the render error) aren't reachable from it.
// BriefPanel writes them here as they change; the dialog reads them on open.
//
// Mirrors the active-project.ts get/set/subscribe shape, but deliberately
// in-memory (no localStorage): this is throwaway state about the current tab,
// and a stale briefId from a previous session would make reports misleading.

export interface ReportContext {
  projectId?: string | null;
  briefId?: string | null;
  renderJobId?: string | null;
  renderStatus?: string | null;
  renderUrl?: string | null;
  /** The render-failure message the app otherwise only ever shows in a toast. */
  lastError?: string | null;
}

const CHANGED = "report-context:changed";

let context: ReportContext = {};

/** Merge in what the caller knows. Undefined values are ignored; null clears a field. */
export function setReportContext(patch: ReportContext): void {
  if (typeof window === "undefined") return;
  let changed = false;
  const next: ReportContext = { ...context };
  for (const [k, v] of Object.entries(patch) as [keyof ReportContext, string | null][]) {
    if (v === undefined) continue;
    if (next[k] !== v) {
      next[k] = v;
      changed = true;
    }
  }
  if (!changed) return;
  context = next;
  window.dispatchEvent(new Event(CHANGED));
}

export function getReportContext(): ReportContext {
  return context;
}

export function clearReportContext(): void {
  if (typeof window === "undefined") return;
  context = {};
  window.dispatchEvent(new Event(CHANGED));
}

/** Subscribe to context changes. Returns an unsubscribe fn. */
export function subscribeReportContext(cb: (c: ReportContext) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb(getReportContext());
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
}

/**
 * Short, human-scannable chips of what a report will carry, for the disclosure
 * strip in the dialog. Ids are truncated (a full uuid is noise to a user, and the
 * prefix is enough for us to find the row).
 */
export function describeReportContext(c: ReportContext, url?: string): string[] {
  const short = (v: string) => (v.length > 8 ? `${v.slice(0, 8)}…` : v);
  const chips: string[] = [];
  if (url) chips.push(`page ${new URL(url, "http://x").pathname}`);
  if (c.briefId) chips.push(`brief ${short(c.briefId)}`);
  else if (c.projectId) chips.push(`project ${short(c.projectId)}`);
  if (c.renderJobId) chips.push(`render ${short(c.renderJobId)}`);
  if (c.renderStatus) chips.push(`status ${c.renderStatus}`);
  if (c.lastError) chips.push("last error");
  return chips;
}
