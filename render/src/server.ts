import "./env.js";
import express from "express";
import { join } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { JobState, RenderJobInput } from "./types.js";
import { runJob } from "./job.js";
import { RENDER_ROOT } from "./render.js";
import { createSemaphore } from "./semaphore.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Allow the Next app (any origin) to call the render API + fetch outputs.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-render-token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});

// Serve finished renders so the result is downloadable at /out/edited-<jobId>.mp4.
app.use("/out", express.static(join(RENDER_ROOT, "out")));

// Optional shared-secret auth: when RENDER_TOKEN is set, /render routes require it.
// /health stays open (Railway healthcheck); /out is unguessable per-job UUIDs.
const RENDER_TOKEN = process.env.RENDER_TOKEN;
function tokenOk(sent: unknown): boolean {
  if (typeof sent !== "string" || !RENDER_TOKEN) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(RENDER_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b); // constant-time; no early-exit timing leak
}
app.use("/render", (req, res, next) => {
  if (!RENDER_TOKEN || req.method === "OPTIONS") return next();
  if (tokenOk(req.headers["x-render-token"])) return next();
  res.status(401).json({ error: "unauthorized" });
});

// In-memory job table. A render is 30s-2min, so we hand back a jobId and let the
// client poll — a synchronous HTTP call would time out.
const jobs = new Map<string, JobState>();

// Cap concurrent renders. Measured on the Railway box (2026-07-10): 2 is the sweet spot
// (faster per-job than 1 via I/O overlap), 3 OOMs the ffmpeg composite. Env-tunable so the
// limit can be dropped to 1 from the Railway dashboard without a rebuild. See DECISIONS.md.
const RENDER_CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 2);
const renderGate = createSemaphore(RENDER_CONCURRENCY);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "proof-render" });
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

  const id = randomUUID();
  const now = Date.now();
  jobs.set(id, { id, status: "queued", startedAt: now, updatedAt: now });

  // Fire and forget; progress is polled via GET /render/:id. The render gate caps how many
  // jobs execute at once — excess jobs stay "queued" here until a slot frees, instead of all
  // starting together and thrashing the box. runJob flips the status off "queued" once it runs.
  renderGate
    .run(() =>
      runJob(id, input, (status, extra) => {
        const cur = jobs.get(id);
        if (cur) jobs.set(id, { ...cur, status, ...extra, updatedAt: Date.now() });
      }),
    )
    .then((result) => {
      const cur = jobs.get(id) ?? { id, startedAt: now };
      jobs.set(id, {
        ...(cur as JobState),
        status: "done",
        mp4Url: result.mp4Url,
        renderId: result.renderId,
        updatedAt: Date.now(),
      });
    })
    .catch((err: Error) => {
      const cur = jobs.get(id) ?? { id, status: "error", startedAt: now, updatedAt: now };
      jobs.set(id, { ...(cur as JobState), status: "error", error: err.message, updatedAt: Date.now() });
      console.error(`[job ${id}] failed:`, err);
    });

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
});
