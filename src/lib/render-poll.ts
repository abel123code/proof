export interface RenderPollJob {
  status: string;
  phase: string;
  progress: number;
  outputUrl: string | null;
  error: string | null;
}

export type RenderPollResult =
  | { status: "done"; progress: 100; url: string }
  | { status: "error"; progress: number; error: string | null }
  | { status: string; progress: number }
  | null;

/** The requested durable job is authoritative; a brief URL may belong to an older render. */
export function resolveRenderPoll(args: {
  durable: RenderPollJob | null;
  persistedUrl?: string | null;
}): RenderPollResult {
  const { durable } = args;
  if (!durable) return null;
  if (durable.status === "done" && durable.outputUrl) {
    return { status: "done", progress: 100, url: durable.outputUrl };
  }
  if (durable.status === "error") {
    return { status: "error", progress: durable.progress, error: durable.error };
  }
  return {
    status: durable.phase || durable.status,
    progress: durable.progress,
  };
}
