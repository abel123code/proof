# proof — Architectural Decision Records

**Append-only.** Never delete entries. If a decision is reversed, add a NEW entry referencing the old one.

Format: `## YYYY-MM-DD: Short title` → Context → Decision → Alternatives considered → Consequences → References.

For **what proof is** → [README.md](README.md)
For **the render service** → [render/README.md](render/README.md)
For **project rules** → [AGENTS.md](AGENTS.md) (imported by CLAUDE.md)

---

## 2026-07-10: Cap concurrent renders at 2 (env-tunable), don't run unbounded

**Context:** the render service (`render/`) runs on a single Railway box (24 vCPU / 24 GB). `POST /render` fired `runJob` immediately with no queue or limit — so N simultaneous requests started N heavy renders at once. A render is CPU-bound (Remotion parallelizes frames across all cores) and holds a large transparent ProRes overlay in memory during the ffmpeg composite. Concern raised before the SUTD demo: if a room of students taps "render" in the same window, the box thrashes and renders fail live.

**Decision:** gate renders behind an async semaphore (`render/src/semaphore.ts`), cap = `RENDER_CONCURRENCY` env var, **default 2**. Excess jobs stay in the existing `queued` status until a slot frees, instead of all starting together. Env-tunable so the cap can be dropped to 1 from the Railway dashboard (a ~15s restart) without a code change + Docker rebuild — an emergency knob if it thrashes live.

**The number is measured, not guessed.** Load-tested the live box 2026-07-10 (concurrent 15s renders, `render/tmp/loadtest.ts`):

| Concurrent | Result | Avg time/job |
|---|---|---|
| 1 | 1/1 ok | 34.4s |
| 2 | 2/2 ok | 27.6s |
| 3 | **2/3 — one failed** | ffmpeg OOM |

- **1 render already saturates the CPU**, so concurrency doesn't multiply throughput — it splits the same cores.
- **2 is faster per-job than 1** (27.6s vs 34.4s) because a job spends seconds idle on network I/O (whisper transcription, Supabase upload) where a second job's compute fills the gap. Better utilization, still under the memory ceiling.
- **3 OOMs the composite.** The failed job died with `ffmpeg exited 1: Failed to inject frame into filter network: Resource temporarily unavailable` (confirmed in Railway logs) — memory exhaustion with three ProRes overlays in flight.

**Alternatives considered:**
- **Cap 1** — safe, but wastes the idle-I/O window and is slower per job. Rejected as the default; kept as the emergency fallback via the env var.
- **Cap 3+ / unbounded** — rejected, measured to drop jobs (OOM).
- **Horizontal scale (multiple render replicas / autoscaling)** — the correct answer for real simultaneous scale, but real infra + cost. Overkill for a hackathon demo with dozens of users trickling in. Deferred.
- **A real job queue (e.g. Trigger.dev, which the original stack used)** — heavier; the in-process semaphore is enough for one box. Deferred.

**Consequences:** excess renders wait rather than crash; `queued` status is now meaningful (client already handles it). Server logs the cap at startup. **Caveat:** measured with 15s clips — longer clips hold more memory per job, so a 60s+ workload may need the cap dropped to 1. Retrying failed jobs is NOT implemented (an OOM'd or errored job stays `error`; client re-submits). Job state is still in-memory, so a redeploy mid-render still loses in-flight jobs (separate open issue).

**References:** `render/src/semaphore.ts`, `render/src/server.ts` (`renderGate`), `render/tests/semaphore.test.ts`, load test `render/tmp/loadtest.ts`; PR [#1](https://github.com/abel123code/proof/pull/1); related follow-up in memory `whisper-script-prompt` (transcription accuracy).

---

## 2026-07-10: Move the render service off Zo onto Railway

**Context:** the hackathon render service ran on a Zo Computer, driven over the Zo MCP server with a `zo_sk_` root token. Great for a 12-hour build (full root, instant box), wrong for a public beta: the token is root on the whole machine, the host isn't a deploy target we control declaratively, and there's no image to reproduce.

**Decision:** containerise the service and deploy on **Railway** (`proof-render-production.up.railway.app`). Dockerfile installs ffmpeg + chromium libs and **pre-warms the browser before the source copy** so the heavy layer caches across rebuilds. `railway.json` uses the dockerfile builder with a `/health` healthcheck. Env files are dockerignored so Railway dashboard vars can't be silently overridden by a baked-in file.

**Alternatives considered:** stay on Zo (rejected — root-token blast radius, not reproducible); serverless (rejected — ffmpeg + headless Chromium won't fit the execution/memory limits); a VM we hand-manage (rejected — no upside over Railway at this size).

**Consequences:** reproducible image, declarative deploys, and a dashboard for env + restarts. The old Zo `zo_sk_` token should be revoked. Job state is still in-memory, so a redeploy mid-render drops in-flight jobs (open item).

**References:** PR [#1](https://github.com/abel123code/proof/pull/1); `render/Dockerfile`, `render/railway.json`, `.dockerignore`; `docs/2026-07-09-railway-render-deploy.md`.

---

## 2026-07-11: Upload footage direct-to-Supabase with signed URLs (not through the API route)

**Context:** recorded scene footage was POSTed through a Next.js API route, so every upload paid the serverless request-body limit. Clips longer than ~30s failed. Separately, footage and render rows were addressable by ID without an ownership check (IDOR).

**Decision:** issue a **signed upload URL** and have the browser upload **straight to Supabase Storage**, bypassing the serverless body cap entirely. In the same change, close the **footage/render IDOR** by scoping reads/writes to the owning user.

**Alternatives considered:** chunked multipart through the API route (rejected — more moving parts, still pays serverless overhead); raising the body limit (not available on the platform at the needed size).

**Consequences:** long takes upload reliably and the app server stops proxying large binaries. Client now needs a signed-URL round-trip before recording uploads.

**References:** PR [#2](https://github.com/abel123code/proof/pull/2).

---

## 2026-07-11: Replace the lifetime edit cap with a credit wallet

**Context:** usage was gated by `EDIT_LIFETIME_CAP` (default 3 renders, for life). Fine for a demo, wrong for a beta where users iterate on a video several times — they'd hit a wall after three attempts and stop.

**Decision:** a **unified credit wallet** with a live balance in the UI. New users start at **1000 credits (~5 videos)**. Credits are charged on render and confirmed on completion, so a failed job doesn't silently burn the balance.

**Alternatives considered:** raise the lifetime cap (rejected — same cliff, further out); per-day rate limit only (rejected — doesn't express that renders have real compute cost).

**Consequences:** quota logic moves from a hard cap to a balance the user can see and reason about; groundwork for paid top-ups later. `EDIT_LIFETIME_CAP` references in older docs are superseded.

**References:** commits `bc14d46` (wallet), `62d8442` (1000-credit default), `914f125` (preserve jobs + confirm credit charges); `supabase/migrations/0011_credits.sql`.

---

## 2026-07-12: Lock the data plane down before opening the beta

**Context:** opening to outside users on a public repo means the database is the blast radius. Some public tables still had no row-level security, and project-scoped API routes trusted the caller's ID without verifying ownership.

**Decision:** enable **RLS on all remaining public tables** and **enforce project ownership** on every project-scoped route. Treat "unauthenticated can reach it" as the default threat, not an edge case.

**Alternatives considered:** rely on route-level checks alone (rejected — one missed route is a full data leak; RLS fails closed at the database).

**Consequences:** all new tables must ship with a policy or they're unreachable — intentional friction. Server-side code must use the service-role key deliberately, and only server-side.

**References:** commits `d2004d3` (RLS), `5eb5c3b` (project ownership); `supabase/migrations/0012_lockdown_rls.sql`.

---

## 2026-07-14: Premium bespoke-scene engine — LLM storyboard → programmatic render → vision QA

**Context:** the standard pipeline captions and cuts a talking-head take. That ceilings out: the video is only as good as the footage. To produce genuinely designed scenes (the kind a launch video needs), scenes have to be *generated*, not just captioned — and generated scenes fail in ways text can't detect (overlapping elements, unreadable contrast, clipped text).

**Decision:** a **premium bespoke-scene pipeline** — an LLM storyboards each scene, the scene is rendered programmatically, and a **vision model QAs the rendered frames** and flags failures. Also feed the known script to whisper as a **vocabulary prompt** so domain terms transcribe correctly.

**Alternatives considered:** hand-authored scene templates only (rejected — doesn't generalise across products); trusting the LLM's scene description without rendering-and-checking (rejected — that's precisely the failure mode).

**Consequences:** a second, slower, more expensive tier alongside the standard path. **E2E finding: the model is not the pass-rate lever** — design quality + the QA loop is; swapping models did not move pass rate. Productionisation continues in PRs #8/#9 (asset-inclusion gate, PNG logos, anchor-drop fix).

**References:** PR [#5](https://github.com/abel123code/proof/pull/5); commits `fb9c26f`, `1398dc5`, `4bb7be2` (render v2 brief-driven durable pipeline); memory `premium-engine-status`.

---

## 2026-07-14: Stay on Remotion — do not switch the render engine to HyperFrames

**Context:** while building the bespoke-scene engine the obvious question was whether to move the whole renderer to HyperFrames, since scene composition was being authored there.

**Decision:** **stay on Remotion.** Both render the same frames through headless Chromium; swapping engines does not change output quality.

**Alternatives considered:** port the pipeline to HyperFrames (rejected — a large migration for no quality delta, and it would churn a service that is deployed and working).

**Consequences:** the `render/` service stays stable and deployed. **The quality lever is design + a QA loop, not the engine** — effort goes into the storyboard/QA loop instead of a rewrite. Revisit only if Remotion blocks something HyperFrames makes possible.

**References:** `ROADMAP.md` (Render service); the demo-video experiment in `render/tmp/` (gitignored) that settled it.

---

## 2026-07-15: Treat premium asset fetching as untrusted input (SSRF + local-file-read)

**Context:** the bespoke-scene engine fetches user-supplied asset URLs (screenshots, logos) server-side. Unconstrained, that's a textbook **SSRF** primitive — a user can point it at internal/metadata endpoints or a `file://` path and have the server read what it shouldn't.

**Decision:** treat every asset URL as hostile. **Allowlist** permitted hosts (including the project's public Supabase URL), block local/internal targets and non-HTTP schemes, **stream reads with a hard size cap** rather than buffering whatever arrives, harden the size-limit env parse, and **cancel/drain rejected responses** so a refused fetch can't still stream a body.

**Alternatives considered:** validate the URL string only (rejected — redirects and DNS rebinding walk straight past it); no server-side fetching at all (rejected — the engine needs the assets).

**Consequences:** users must host assets on allowlisted origins. Any new outbound fetch in this service has to go through the same guard.

**References:** PR [#6](https://github.com/abel123code/proof/pull/6); commits `a67c702`, `d020997`, `d0930b5`, `eaf4878`.
