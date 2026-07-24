import "./env.js";
import express from "express";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { JobState, RenderJobInput } from "./types.js";
import { runJob } from "./job.js";
import { RENDER_ROOT } from "./render.js";
import { createSemaphore } from "./semaphore.js";
import { heartbeatDurableJob, loadRecoverableJobs, updateDurableJob } from "./durable.js";
import { enforceWorkerEditMode, resolveWorkerEditMode } from "./edit-mode.js";
import { resolveWorkerSecurityConfiguration, workerRequestAuthorized } from "./server-auth.js";
import { hyperframesAvailable } from "./premium/hyperframes.js";
import { premiumEngineWarning } from "./premium/fallback.js";
import { markJobDone } from "./completion.js";

// Resolve the security posture ONCE at startup. With no RENDER_TOKEN this throws (unless the
// explicit local-dev escape hatch is set) so a misconfigured box refuses to boot rather than
// serving the worker unauthenticated. See server-auth.ts.
const SECURITY = resolveWorkerSecurityConfiguration(process.env);

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-render-token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});

// Fail-closed worker auth, applied to BOTH the job API and the /out download dir. The vulnerability
// was that /out was served UNAUTHENTICATED (and /render auth failed OPEN with no token) — not that
// /out exists — so gate /out behind the token rather than removing it, which would strand the
// download for legacy non-briefId render jobs whose output only lives at /out. In the explicit
// local-dev posture (allowUnauthenticated, bound to loopback) both are open.
const requireWorkerAuth: express.RequestHandler = (req, res, next) => {
  if (req.method === "OPTIONS") return next();
  if (workerRequestAuthorized(req.headers["x-render-token"], SECURITY.renderToken, SECURITY.allowUnauthenticated)) {
    return next();
  }
  res.status(401).json({ error: "unauthorized" });
};

app.use("/render", requireWorkerAuth);
app.use("/out", requireWorkerAuth, express.static(join(RENDER_ROOT, "out")));

const jobs = new Map<string, JobState>();
const activeIds = new Set<string>();
const RENDER_CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 2);
const renderGate = createSemaphore(RENDER_CONCURRENCY);
const WORKER_EDIT_MODE = resolveWorkerEditMode(process.env.RENDER_EDIT_MODE);

function enqueueJob(id: string, input: RenderJobInput): void {
  if (activeIds.has(id)) return;
  const now = Date.now();
  activeIds.add(id);
  jobs.set(id, jobs.get(id) ?? { id, status: "queued", startedAt: now, updatedAt: now });

  const enforcedInput = enforceWorkerEditMode(input, WORKER_EDIT_MODE);
  renderGate
    .run(() =>
      runJob(id, enforcedInput, (status, extra) => {
        const current = jobs.get(id);
        if (current) jobs.set(id, { ...current, status, ...extra, updatedAt: Date.now() });
        void updateDurableJob(id, status).catch((error) =>
          console.warn(`[job ${id}] durable status update failed:`, error),
        );
      }),
    )
    .then(async (result) => {
      await markJobDone(id, result.mp4Url);
      const current = jobs.get(id) ?? { id, startedAt: now };
      jobs.set(id, {
        ...(current as JobState),
        status: "done",
        mp4Url: result.mp4Url,
        renderId: result.renderId,
        updatedAt: Date.now(),
      });
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
app.listen(PORT, SECURITY.host, () => {
  const auth = SECURITY.allowUnauthenticated ? "UNAUTHENTICATED local-dev" : "token-required";
  console.log(
    `proof render service listening on ${SECURITY.host}:${PORT} (${auth}, max ${RENDER_CONCURRENCY} concurrent renders, mode ${WORKER_EDIT_MODE})`,
  );
  // If premium is selected but the engine can't run, EVERY render silently ships the caption-only base.
  // Say so at boot instead of leaving each render to fail into a fallback nobody sees.
  const engineWarning = premiumEngineWarning(WORKER_EDIT_MODE, hyperframesAvailable());
  if (engineWarning) console.error(engineWarning);
  void recoverJobs().catch((error) => console.warn("durable render recovery unavailable:", error));
});

setInterval(() => {
  void recoverJobs().catch(() => {});
}, 10_000).unref();

setInterval(() => {
  for (const id of activeIds) {
    void heartbeatDurableJob(id).catch((error) =>
      console.warn(`[job ${id}] durable heartbeat failed:`, error),
    );
  }
}, 60_000).unref();
