import "./env.js";
import express from "express";
import { join } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { JobState, RenderJobInput } from "./types.js";
import { runJob } from "./job.js";
import { RENDER_ROOT } from "./render.js";
import { createSemaphore } from "./semaphore.js";
import { loadRecoverableJobs, updateDurableJob } from "./durable.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-render-token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});

app.use("/out", express.static(join(RENDER_ROOT, "out")));

const RENDER_TOKEN = process.env.RENDER_TOKEN;
function tokenOk(sent: unknown): boolean {
  if (typeof sent !== "string" || !RENDER_TOKEN) return false;
  const provided = Buffer.from(sent);
  const expected = Buffer.from(RENDER_TOKEN);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

app.use("/render", (req, res, next) => {
  if (!RENDER_TOKEN || req.method === "OPTIONS") return next();
  if (tokenOk(req.headers["x-render-token"])) return next();
  res.status(401).json({ error: "unauthorized" });
});

const jobs = new Map<string, JobState>();
const activeIds = new Set<string>();
const RENDER_CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 2);
const renderGate = createSemaphore(RENDER_CONCURRENCY);

function enqueueJob(id: string, input: RenderJobInput): void {
  if (activeIds.has(id)) return;
  const now = Date.now();
  activeIds.add(id);
  jobs.set(id, jobs.get(id) ?? { id, status: "queued", startedAt: now, updatedAt: now });
  void updateDurableJob(id, "queued").catch(() => {});

  renderGate
    .run(() =>
      runJob(id, input, (status, extra) => {
        const current = jobs.get(id);
        if (current) jobs.set(id, { ...current, status, ...extra, updatedAt: Date.now() });
        void updateDurableJob(id, status).catch((error) =>
          console.warn(`[job ${id}] durable status update failed:`, error),
        );
      }),
    )
    .then((result) => {
      const current = jobs.get(id) ?? { id, startedAt: now };
      jobs.set(id, {
        ...(current as JobState),
        status: "done",
        mp4Url: result.mp4Url,
        renderId: result.renderId,
        updatedAt: Date.now(),
      });
      void updateDurableJob(id, "done", { outputUrl: result.mp4Url }).catch((error) =>
        console.warn(`[job ${id}] durable completion update failed:`, error),
      );
    })
    .catch((error: Error) => {
      const current = jobs.get(id) ?? { id, status: "error", startedAt: now, updatedAt: now };
      jobs.set(id, {
        ...(current as JobState),
        status: "error",
        error: error.message,
        updatedAt: Date.now(),
      });
      void updateDurableJob(id, "error", { error: error.message }).catch(() => {});
      console.error(`[job ${id}] failed:`, error);
    })
    .finally(() => activeIds.delete(id));
}

async function recoverJobs(): Promise<void> {
  const recoverable = await loadRecoverableJobs(activeIds);
  for (const input of recoverable) {
    if (input.jobId) enqueueJob(input.jobId, input);
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "proof-render", activeJobs: activeIds.size });
});

app.post("/render", (req, res) => {
  const input = req.body as RenderJobInput;
  const hasSingle = !!input?.videoUrl && !!input?.brief;
  const hasMulti = Array.isArray(input?.videoUrls) && input.videoUrls.length > 0 && !!input?.brief;
  if (!input || (!input.captureId && !hasSingle && !hasMulti)) {
    res.status(400).json({
      error: "Provide captureId, or videoUrl+brief, or videoUrls[]+brief.",
    });
    return;
  }

  const id =
    typeof input.jobId === "string" && /^[0-9a-f-]{36}$/i.test(input.jobId)
      ? input.jobId
      : randomUUID();
  const now = Date.now();
  jobs.set(id, jobs.get(id) ?? { id, status: "queued", startedAt: now, updatedAt: now });
  enqueueJob(id, { ...input, jobId: id });
  res.status(202).json({ jobId: id });
});

app.get("/render/:id", (req, res) => {
  const state = jobs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "unknown job" });
    return;
  }
  res.json(state);
});

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, () => {
  console.log(`proof render service listening on :${PORT} (max ${RENDER_CONCURRENCY} concurrent renders)`);
  void recoverJobs().catch((error) => console.warn("durable render recovery unavailable:", error));
});

setInterval(() => {
  void recoverJobs().catch(() => {});
}, 10_000).unref();
