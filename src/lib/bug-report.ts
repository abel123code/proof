import type { BugReportContext } from "@/lib/db";

/** Max characters kept from a report message. Long enough for a real description. */
export const MAX_BUG_MESSAGE = 2000;
/** Max characters kept from any single context string (urls/errors can be huge). */
const MAX_CONTEXT_FIELD = 500;

const CONTEXT_KEYS = [
  "url",
  "projectId",
  "briefId",
  "renderJobId",
  "renderStatus",
  "renderUrl",
  "lastError",
  "userAgent",
] as const;

/**
 * Validate + clamp a client-supplied bug report before it's persisted. The context is
 * best-effort and fully client-controlled, so keep only known string keys, trim them,
 * and cap the length. Returns null when there's no usable message.
 */
export function sanitizeBugReport(raw: Record<string, unknown>): {
  message: string;
  context: BugReportContext;
} | null {
  const message =
    typeof raw.message === "string" ? raw.message.trim().slice(0, MAX_BUG_MESSAGE) : "";
  if (!message) return null;

  const rawContext =
    raw.context && typeof raw.context === "object"
      ? (raw.context as Record<string, unknown>)
      : {};

  const context: BugReportContext = {};
  for (const key of CONTEXT_KEYS) {
    const v = rawContext[key];
    if (typeof v === "string" && v.trim()) {
      context[key] = v.trim().slice(0, MAX_CONTEXT_FIELD);
    }
  }
  return { message, context };
}
