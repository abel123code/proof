# proof — Architectural Decision Records

**Append-only.** Never delete entries. If a decision is reversed, add a NEW entry referencing the old one.

Format: `## YYYY-MM-DD: Short title` → Context → Decision → Alternatives considered → Consequences → References.

For **what proof is** → [README.md](README.md)
For **the render service** → [render/README.md](render/README.md)
For **project rules** → [AGENTS.md](AGENTS.md)

---

## 2026-07-10: Cap concurrent renders at 2 (env-tunable), don't run unbounded

**Status:** The concurrency decision remains active. The original in-memory job-state caveat was
superseded by durable `render_jobs` storage and restart recovery in `4bb7be2`.

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

**Consequences:** excess renders wait rather than crash; `queued` status is meaningful. Server
logs the cap at startup. The measurement used 15-second clips, so a 60-second workload may need
the cap dropped to 1. Durable jobs now survive worker restarts, but an errored job still requires
an explicit resubmission.

**References:** `render/src/semaphore.ts`, `render/src/server.ts` (`renderGate`),
`render/tests/semaphore.test.ts`, and PR [#1](https://github.com/abel123code/proof/pull/1).

---

## 2026-07-21: Make vision-reviewed scenes the operator-owned default

**Context:** The browser sent `editMode: "brief-driven"`, which bypassed the premium author and
vision gate even when the legacy `premium` boolean was enabled. A live SUTD fixture exposed a
second failure: fixed keyword chips were already burned into the captioned base. Vision QA
correctly rejected the chip for entering the protected head zone, then sent an impossible repair
to the scene author because the author did not own that base layer. Review found the same issue
for fixed text-card overlays.

**Decision:** The Next.js route and render worker own render mode and default to
`generated-experimental`. Client mode fields are ignored at both boundaries. Operators can set
`RENDER_EDIT_MODE` to `brief-driven` or `classic` on both services. Premium mode omits fixed
keyword chips and text-card overlays, masks authored alpha over the moving-speaker and caption
zones, then submits five composited frames to GPT-5.6 Sol at original detail. Rejected reasons
feed the next author attempt. Parsing remains fail closed, and vision QA has no runtime bypass.
Model-authored HTML still passes the sanitizer before rendering.

Premium OpenAI requests use a 90-second per-attempt timeout and one retry. This gives one chance
to recover from a connection reset while bounding the SDK retry window.

Programmatic Tool Calling is excluded from this loop because each vision verdict changes the
next author request. Independent scenes still run concurrently behind the cap of two.

**Alternatives considered:**

- Keep premium as a client flag. Rejected because stale clients can silently bypass QA.
- Loosen or disable QA. Rejected after visual inspection confirmed the reported face overlap,
  clipped wordmark, and empty transition.
- Rely on coordinate instructions alone. Rejected after Sol repeated the same protected-zone
  violation across two repair prompts.
- Let QA review fixed keyword chips. Rejected because the author cannot repair a graphic already
  present in the base video.

**Consequences:** Premium mode has fewer fixed overlays, a deterministic face-safety floor, and a
useful adaptive repair loop. Scenes can still be rejected for clipping, weak contrast, wrong
copy, empty frames, or poor design after masking. Full rendering remains slow.

**Evidence:** On 2026-07-21, an eight-second real fixture completed in 397 seconds. QA rejected
two scene variants, approved the second repair, and the final 1080x1920 MP4 differed from the
caption-only base. See `render/src/job.ts`, `render/src/ffmpeg.ts`,
`render/src/premium/index.ts`, `render/src/premium/qa.ts`, and the tests in `render/tests/`.

---

## 2026-07-23: QA is an auditable advisor — scenes ship flagged, never silently omitted

**Status:** Active. Supersedes the "rejected scenes are repaired or omitted" behaviour of the
2026-07-22 editorial-QA entry above (which is otherwise unchanged: no erase-mask, deterministic
caption check, editorial vision QA, patch-not-reroll retries).

**Context:** A frozen-fixture retest (2026-07-23) shipped only 2 of 5 scenes. Eyeballing the three
omitted scenes showed the omissions were mostly *wrong*: scene-2 and scene-5 were face-clear,
caption-clear and shippable but were deleted for **subjective** reasons — an unrealized creative
beat, and a two-word badge copy ORDER ("PROOF EDITED BY" vs "EDITED BY PROOF"). Worse, the pipeline
ran ~30 min and then showed the user *nothing* for those beats, with no reason surfaced — a black box
that silently drops work. The product bar (stated by the founder, citing Voltade's auditable-agent
model): every agent action must be auditable — the user must see *why*, and *the human* decides
whether to re-render, especially for anything subjective.

**Decision:** QA becomes an **auditable advisor**, not a silent gatekeeper.
- Each QA finding is tagged `safety` (objective: missing/clipped/unreadably small required wording,
  graphic in the caption band, garbled text, duplicated captions, broken render, missing required asset) or
  `subjective` (creative/copy/polish — a matter of taste). When unsure, default to `subjective`.
- **A scene is never silently omitted.** `safety` faults drive an auto-patch up to the retry budget;
  if still unresolved, the scene **ships FLAGGED** (the founder chose ship-it-flagged over base
  fallback). `subjective` notes NEVER block and NEVER drive a re-author — they ride along as flags.
- Every scene carries a `SceneReport` (`verdict` clean|flagged|base_fallback, `shipped`, tagged
  `issues`, `attempts`). `runPremium` returns the reports and writes `scene-report.json`; the app
  surfaces each scene's verdict + reasoning and asks the user, per scene, whether to re-render.
- The captioned base is the per-scene fallback (`base_fallback`) only when a scene cannot be
  rendered safely at all (HTML fails the security validator) — the one true non-ship case.
- Bumping the retry budget was explicitly REJECTED as the fix: it adds latency to a black box the
  user already can't see into. The fix is auditability + human control, not more silent retries.

**Alternatives considered:**
- Keep omitting, just loosen the QA rubric. Rejected — still silent, still no reasoning, and a
  loosened bar ships genuine safety faults unflagged.
- Fall back to captions-only for a failed beat. Rejected as the default (the founder chose
  ship-it-flagged) but kept as the `base_fallback` for the unrenderable-HTML case.
- Bump `PREMIUM_MAX_QA_ITERS`. Rejected (see above).

**Consequences:** Every scene ships with a machine-readable audit record; nothing is dropped without
a visible reason. The web app can render a per-scene "here's what QA flagged — re-render?" review
step. A flagged scene may ship with an unresolved safety issue (by design — the human decides), so
the flag MUST be surfaced. Remaining work: persist `SceneReport` with the render job and build the
studio review UI + a per-scene re-render endpoint. See `render/src/types.ts` (`SceneIssue`,
`SceneReport`), `render/src/premium/index.ts` (`produceScene`, `runPremium`),
`render/src/premium/qa.ts`, and `render/tests/premium.test.ts`.

---

## 2026-07-24: One visual authority per beat; captions composite last

**Status:** Active.

**Context:** A frame-by-frame comparison against a founder-edited creator video showed that graphic
frequency was not the main quality problem. The reference used graphics through most of its runtime,
but separated visual modes: clean talking head, one supporting overlay, or a full-frame explanation.
Proof instead instructed every scene to build chips, dashboards, panels, timelines, and waveforms
around the face. Full-frame animation was also structurally impossible because premium scenes were
transparent, speaker-masked overlays composited after captions.

**Decision:**

- GPT-5.6 Sol produces one global typed edit plan before scene authoring. The plan assigns `overlay`
  or `full-frame`; timeline gaps intentionally remain clean A-roll.
- TypeScript enforces the editorial budget: at least 25% clean runtime, no more than 40% full-frame,
  no more than 35% overlay, face-led opening/closing, recovery after full-frame sequences, and one
  three-second clean interval in videos over 30 seconds.
- Every scene receives one shared creative direction. Continuity comes from palette, typography,
  spacing, motif, and transition grammar, not mandatory dashboard chrome.
- Overlay scenes receive a deterministic caption-band alpha mask and always keep footage visible.
  Face overlap is allowed because readable mobile-sized wording takes priority over preserving every face feature.
  Full-frame scenes independently select `footage` or `black`: black is reserved for animation that
  occupies most of the frame or must be the sole focus.
  The compositor supplies the black background, so authored HTML remains transparent in both cases.
- QA reviews the selected background treatment. A black takeover treats the absent speaker as
  intentional; footage-backed scenes allow face overlap and treat missing, clipped, or sub-56px essential
  wording as an objective repair fault.
- Composition order is clean footage -> creator visuals -> captions. QA reviews the same order.
- A planner decision to use zero enhanced scenes is valid clean A-roll, not a premium failure.

**Consequences:** HyperFrames can now own the complete frame when the visual carries the explanation,
while short supporting graphics remain singular and speaker-led. Captions remain readable because they
are composited last. `SceneReport` adds the selected mode, background treatment, and rationale, while
`edit-plan.json` records coverage and clean intervals. The public render brief and database schema do
not change.

---

## 2026-07-29: Both renderers get their browser baked in; the alpha mask never touches rgba

**Status:** Active. Two hard environment constraints for the render image, both learned from a
production outage that shipped 0-animation videos. Full narrative in `POST_MORTEMS.md` (2026-07-29).

**Context.** Production renders were completing and shipping with **zero bespoke scenes**. Two
independent faults, both latent since the premium engine landed:

1. `render/Dockerfile` pre-warmed only **Remotion's** chrome-headless-shell. Remotion and HyperFrames
   keep browsers in **separate** caches (`/app/node_modules/.remotion/...` vs
   `/home/node/.cache/hyperframes/...`), so HyperFrames cold-downloaded Chrome on every render. That
   download needs a system zip archiver: `unzip` was absent and `yauzl` is an **optional peer
   dependency** npm skips. With no Railway volume (`volumeMounts: []`) nothing cached between
   restarts, so **prod could never render a scene**. It appeared to work only because the team
   rendered locally, where a system Chrome exists.
2. `SPEAKER_SAFE_ALPHA_FILTER` ran `format=rgba,drawbox=...,format=yuva444p10le` over HyperFrames'
   ProRes 4444 **yuva444p12le** output. That 12-bit to 8-bit to 10-bit chain **segfaults ffmpeg 5.1**
   (exit 139, reproducible on any scene mov). The mask only runs for `mode === "overlay"`, so it
   silently killed **every overlay scene** while full-frame scenes rendered — reading as "half the
   animations are missing".

**Decision.**

- The image **provisions both browsers at build time**: `npx remotion browser ensure` *and*
  `npx hyperframes browser ensure`, with `unzip` installed. No render may depend on a runtime browser
  download. Removing either line silently disables an entire renderer.
- `SPEAKER_SAFE_ALPHA_FILTER` **converts straight to `yuva444p10le` and draws there**. It must never
  route through `format=rgba`. A regression test (`render/tests/ffmpeg-filter.test.ts`) asserts the
  filter contains no `rgba`. The rgba hop was also silently discarding alpha precision.

**Alternatives considered.**

- *Point `HYPERFRAMES_BROWSER_PATH` at a system Chrome.* Rejected: the slim base image ships only
  chromium **libraries**, not a browser binary, so this would need a heavier apt install.
- *Add `yauzl` as an explicit dependency* so the runtime download can extract. Rejected as the primary
  fix — it still leaves a network dependency mid-render. Baking the browser is strictly better.
- *Mount a Railway volume to cache the browser.* Rejected: solves caching, not the first cold start,
  and adds state to a stateless worker.
- *Drop the caption-band mask entirely* (caption-guard already relocates intruding graphics). Deferred
  — plausible per the 2026-07-23 advisor ADR, but it removes a safety net and was out of scope for an
  outage fix. Revisit deliberately.

**Consequences.** Docker builds are slower and the image is about 115 MB larger (a second headless
shell). Verified in the production container: chrome binary present, `unzip` present,
`chrome-headless-shell --version` returns, and the previously-segfaulting command exits 0. A real
production render went from **0/6 scenes shipped to 5/5, 0 base-fallback**.

**A deploy is not verified by a boot log.** `hyperframesAvailable()` only checks the CLI resolves; it
cannot see the browser. Verification means downloading the rendered MP4 and inspecting frames. See
`AGENTS.md` "Definition of done" and `POST_MORTEMS.md`.

**References:** `render/Dockerfile`, `render/src/ffmpeg.ts`, `render/src/premium/index.ts` (mask call
site), `render/tests/ffmpeg-filter.test.ts`, PR #18.

---

## 2026-07-31: Private repos via a scoped GitHub App, and Proof never reads source code

**Status:** Active. Shipped in PRs #19 and #20.

**Context.** `src/lib/github.ts` used a single shared server token, so Proof could only ever see
public repositories. Private access was not a missing feature, it was excluded by the auth
architecture. Most real startups keep their code private, which capped the addressable user at
open-source maintainers and hackathon projects. The question came from a founder during outreach:
"do you cater for private repos yet?"

**Decision: a GitHub App the user installs on repositories they pick. Not an OAuth App.**

- The OAuth `repo` scope is all-or-nothing read **and write** across every private repository the
  user can see. That is both an alarming consent screen for the exact audience we are courting, and
  a credential that turns a small breach into an incident. Rejected.
- With an App, **GitHub enforces the boundary** and the consent screen names the specific repos.
- We persist **only the installation id**, which is not a credential and grants nothing by itself.
  Access tokens are minted per request from the app private key, expire in about an hour, and are
  never written to the database or logged, so a database leak cannot be replayed against anyone's
  source.
- **Additive, not a login change.** Login stays Google-only and the manual handle input in Settings
  is untouched, so there is no second identity to reconcile and no disruption to the approved beta
  list. Switching login to GitHub was considered and deferred: it is the better end state for a
  developer product, but it breaks every whitelisted user today.

**Proof reads the README, file names and language stats. It never fetches file contents.** That is
what `fetchRepoSnapshot` does, and the claim shown to users in the connect UI depends on it staying
true. Note the consent screen says "Read access to **code** and metadata" because that is GitHub's
wording for `contents:read`; the permission permits more than we use, so the user-facing copy
describes what Proof does rather than what the token could do.

**Two failure modes fixed on the way, both of the same family: a swallowed error becoming plausible
garbage.**

- GitHub answers **404, not 403**, for private resources the caller cannot see, and
  `fetchRepoSnapshot` caught that as `"(no README found)"`. The pipeline would have scripted a video
  about an empty repo. The access check now sits on `repos.get`, the call that actually fails, so a
  repo that merely has no README still degrades quietly.
- A repo with no README now surfaces a warning instead of silently producing a thin script, because
  the user would otherwise blame the connection.

**Installs that begin on GitHub.** A user can install from `github.com/apps/<slug>` without ever
touching our button, in which case GitHub uses the app's setup URL and there is no signed state of
ours. Rejecting that stranded a real installation; blindly accepting it would let a crafted link
bind someone else's installation to whoever clicks it. Resolved by proving **ownership** instead:
the installation must belong to the GitHub handle already saved on that user's profile.
`decideInstallCallback` is pure so every branch is unit-tested.

**Consequences.** Requires `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY`, plus
migration `0017`. Without the env vars `githubAppConfigured()` is false, the connect UI never
renders, and behaviour is identical to before, so the feature can ship dark. The App must be set to
**"Any account"** or only its owner can install it; GitHub's API does not expose that flag, so it
can only be confirmed in the dashboard.

**Verified against real GitHub**, not mocks: app JWT to installation token to reading a genuinely
private repo (`LearnLoop`, 3663-char README, 159 paths), with the installation seeing only the one
granted repo out of 18, and `installationCanAccess` refusing an ungranted repo.

**References:** `src/lib/github-app.ts`, `src/lib/github.ts`, `src/app/api/github/*`,
`supabase/migrations/0017_github_app_install.sql`, `tests/github-private-repos.test.ts`,
`tests/github-install-callback.test.ts`, `tests/live-github-app.test.ts` (live, skipped in CI).

---

## 2026-08-01: Allowlist decisions come from the verified email, never from auth metadata

**Context.** `isAllowlisted` built a PostgREST `.or()` filter by string-interpolating both the email
and the GitHub handle. The handle came from `user.user_metadata.user_name`, and Supabase lets the
user write that field themselves through `auth.updateUser({ data: ... })` — `app_metadata` is the
protected one, `user_metadata` is not. Setting it to `x,id.not.is.null` produced the filter
`github_username.eq.x,id.not.is.null`, whose second term is true for every row, so the allowlist
matched for anyone holding a Google account. They then received a profile, beta access and a
1000-credit balance.

Reproduced read-only against production, before and after the fix:

```
or=(github_username.eq.notarealhandle)                -> []            no match
or=(github_username.eq.notarealhandle,id.not.is.null) -> [{"id":...}]  EXPLOIT
eq(email, "attacker@example.com,id.not.is.null")      -> []            closed
eq(email, <a real allowlisted address>)               -> [{"id":...}]  still works
```

**Decision.** Authorization is decided from the **provider-verified email only**, bound as a query
argument (`.eq("email", value)`), never concatenated into a filter string. The column
`allowed_users.github_username` still exists and still shows in `/admin`, but carries no
authorization weight. `addAllowedUser`, the admin route and `approveAccessRequest` all require an
email, so a handle-only row can never sit in the table looking approved while admitting nobody.

**Alternatives considered.** *Escape the interpolated value* — insufficient alone: it closes the
injection but leaves plain impersonation open the moment anyone is allowlisted by handle, since the
attacker can just set `user_name` to that handle. *Move the handle into `app_metadata`* — would work,
but adds a write path we do not need; the email already identifies the person and comes from the
identity provider.

**Consequences.** All 17 live allowlist rows had an email, so nobody lost access. Any future identity
signal must be checked for **who can write it** before it influences admission. Forensics after the
fix: 0 of 13 profiles were off the allowlist, so the bypass was never exploited.

**References:** `src/lib/db.ts` (`isAllowlisted`, `addAllowedUser`, `approveAccessRequest`),
`src/app/api/admin/allow/route.ts`, `tests/allowlist.test.ts`, PR #24,
[POST_MORTEMS.md](POST_MORTEMS.md) 2026-08-01.

---

## 2026-08-02: Open signup is a flag, and USER_CAP stays as the spend bound

**Context.** Judges cannot evaluate a product they are locked out of, and approving each one by hand
does not scale to a demo. The obvious move, deleting the invite gate, would have made re-closing it a
code change and a deploy.

**Decision.** `NEXT_PUBLIC_OPEN_SIGNUP=true` makes `ensureProfile` skip the allowlist check. It does
**not** lift `USER_CAP`. The allowlist, the access-request log and every existing user keep working
underneath, so closing signup again is one env change.

**Alternatives considered.** *Delete the allowlist* — rejected: irreversible without a deploy, and it
discards machinery a real beta needs afterwards. *Open signup and lift the cap* — rejected: an open
door with no ceiling is exactly what lets a stranger drain the OpenAI budget and the 1GB Supabase
storage allowance, which stood at 274MB before judging began.

**Consequences.** Blast radius is bounded at `USER_CAP` users however widely the link spreads; 13
profiles existed against a cap of 50, leaving 37 slots. Anyone arriving past the cap gets the "early
access is full" page. Login copy reacts to the flag, because telling a judge they need an invite on a
page that is about to admit them is its own kind of broken. Pair with a spend limit in the OpenAI
dashboard for the other half of the bound.

**References:** `src/lib/signup.ts`, `src/lib/db.ts` (`ensureProfile`), `src/app/login/page.tsx`,
`tests/open-signup.test.ts`, PR #28.

---

## 2026-08-07: Auth fails closed, and a half-configured deploy is refused rather than degraded

**Status:** Active.

**Context:** `requireApprovedUser` treated any incomplete Supabase configuration as developer mode
and handed the caller `DEV_USER_ID` with a PASSING result. Deleting one env var in Vercel would have
made the entire app unauthenticated while service-role database access kept working, and nothing
would have failed loudly. A second, independent copy of the same check lived in `src/proxy.ts` and
gated every page route.

**Decision:**

- Three states, not a boolean: `enforce`, `dev-open`, `misconfigured`. `dev-open` requires BOTH public
  vars absent. Exactly one present is `misconfigured` in every environment, because that is the shape
  that used to look like dev mode and hid the hole.
- `NODE_ENV` is an allowlist (`development`, `test`). Unset, empty, `staging` or a typo is treated
  strictly. An exact match on `"production"` would have failed open on any container that skips the
  `next build` / `next start` lifecycle.
- `misconfigured` returns 503 from the API gates. `src/proxy.ts` redirects non-public pages to
  `/login` but lets `/api/*` through, because redirecting a `fetch()` means the caller parses login
  HTML and `res.json()` throws instead of surfacing the 503.
- Empty strings and the literal `"undefined"` / `"null"` count as absent.

**References:** `src/lib/auth-config.ts`, `src/lib/auth.ts`, `src/proxy.ts`,
`tests/auth-config.test.ts`, `tests/proxy-auth.test.ts`.

---

## 2026-08-07: Clip and asset URLs are allowlisted to our own storage origin

**Status:** Active.

**Context:** `POST /api/render` checked only that `videoUrls` was a non-empty array, then forwarded
every value to the worker, which fetches with redirects and buffers whole bodies. An approved user
could aim it at cloud metadata or at anything large enough to exhaust the box.

**Decision:** An allowlist against our own Supabase storage origin, not a denylist of bad hosts,
because a denylist loses to DNS rebinding and to address literals nobody thought of. Full `origin`
comparison so a lookalike like `ours.supabase.co.evil.com` fails, plus a bucket path prefix. One
shared rejection message across host and path failures, so probing reveals nothing about which rule
was hit. Same shape for brand assets.

Test fixtures must pair a hostile origin with a path that WOULD pass the prefix check. The first
version's fixtures all carried bad paths too, so the origin check could be deleted with the suite
still green.

**References:** `src/lib/media-url.ts`, `src/lib/brand-assets.ts`, `tests/media-url.test.ts`.

---

## 2026-08-07: A repeated render submit reuses the in-flight job, and an abandoned job never wedges a brief

**Status:** Active.

**Context:** Every POST reserved 80 credits and minted a new job id, so a retry, a timeout or a
second tab paid twice for the same footage and queued it against only two worker slots.

**Decision:** Before spending, look up the newest in-flight job for that brief and user and return it
instead of starting a second. Scoped to the owner so a guessed brief id cannot reveal someone else's
job, and placed after the ownership check and before `spendCredits`.

A staleness cutoff is part of the decision, not an add-on: `render/src/durable.ts` gives up after 3
attempts and never writes a terminal status, so a crashed job sits in `processing` forever. Reusing
it unconditionally would have locked that brief out of rendering permanently, with the UI button
disabled and `clearBriefRender` unable to help because it only clears the `briefs` row. A job
untouched for longer than the worker's 15-minute lease is treated as dead.

**Known limitation:** the check is check-then-act across separate round trips, so two genuinely
concurrent submits can still both charge. This fixes sequential retries and double-clicks. Closing it
properly needs a partial unique index on
`render_jobs(brief_id) where status in ('queued','processing')`.

**References:** `src/lib/render-submit.ts`, `src/lib/db.ts` (`findActiveRenderJob`),
`tests/render-idempotency.test.ts`.

---

## 2026-08-07: Raw footage is never deleted after a render

**Status:** Active. Reverses a change that was built, merged and reverted the same day.

**Context:** Storage sat at 340 MB against what was assumed to be a 1 GB free-tier cap, growing about
12 MB per brief. A drain was built to delete raw clips once a render succeeded, and merged.

**Decision:** Reverted, for three independent reasons, any one of which is sufficient:

- **Re-render dies.** `brief-panel.tsx` supports re-rendering a brief and the raw takes are its only
  input. The button would have remained and simply failed, leaving users stuck with generation one.
- **It is often the only copy.** The teleprompter records in the browser and uploads straight to
  storage; nothing lands on the user's device. Only people who filmed on a phone keep an original.
- **The premise was unverified.** The 1 GB figure is the free tier. This project's plan was never
  confirmed, and on Pro the allowance is 100 GB, which at ~12 MB a brief is thousands of briefs from
  mattering.

If storage ever does bind, the answer is a longer retention window plus an explicit user-facing
"delete raw takes" action, not a silent drain triggered by someone else's render.

**References:** `d4263afa` (revert), `ef0dd136` and `43a15b53` (reverted).

---

## 2026-08-07: The planner is told what each staged asset depicts

**Status:** Active.

**Context:** The planner receives asset filenames, which are UUIDs, and has a rule to use real assets
only when they materially prove a claim. It cannot apply that rule to an opaque name. On a brief whose
script mentioned a Telegram chat with no Telegram screenshot uploaded, it requested one anyway, the
author substituted the nearest screenshot, and the finished video showed the product while the
voiceover said Telegram, which reads as the product BEING the chat.

**Decision:** Each image is captioned once at upload and stored on the brief, keyed by the filename
the worker stages it under (post-rasterisation for SVG). The planner payload carries
`{ file, depicts }`. A missing description reads as `unknown`, which keeps the planner conservative.
The existing rule then works unchanged: with descriptions present, a beat whose visual is not in the
asset set falls back to clean A-roll instead of borrowing an unrelated screenshot. Measured on a real
render, clean A-roll rose from 43% to 54% and the substitution stopped.

A caption failure never blocks an upload. Descriptions are internal; the user is not asked to label
anything.

**References:** `src/lib/asset-caption.ts`, `src/lib/describe-image.ts`,
`render/src/premium/scenes.ts`, `tests/asset-caption.test.ts`, PR #31.

---

## 2026-08-07: A scene must keep developing across its full duration

**Status:** Active.

**Context:** A measured production render was static for seconds at a time — mean pixel delta between
0.0 and 1.9 out of 255 between cuts. The graphic scenes were stills held for three to four seconds.
The author prompt caused it: rule 5 said "the timeline duration must be exactly N seconds. Append an
empty tween if needed", and sitting next to "do not add ambient motion merely to keep the frame busy"
the model reasonably concluded it should animate the entrance and then pad.

**Decision:** The timeline must reach its duration through real motion, with the final meaningful beat
landing in the last third. A deterministic pre-render gate rejects a timeline that is half or more
empty hold, or that has fewer than two real tweens, and re-authors it the same way a missing asset
does — before paying for a render and a vision call. A screenshot that is placed and never moved is a
failed scene.

This is not licence for ambient motion; the second beat must carry meaning.

**Known tension:** motion and framing fight each other while a source screenshot is the wrong aspect.
Adding a push-in to a wide desktop capture cropped into 1080x1920 makes the zoom worse, which is what
happened on the first render after this shipped. Deterministic reframing should land before motion is
tuned further.

**References:** `render/src/premium/motion-gate.ts`, `render/src/premium/author.ts`,
`render/tests/motion-gate.test.ts`, PR #30.

---

## 2026-08-08: Rebuild product screenshots as HTML instead of cropping them

**Context:** A scene showing a product screenshot placed it as an `<img>` and cropped it with CSS.
For a wide desktop capture in a 1080x1920 frame this cannot work, and the reason is arithmetic
rather than prompt wording. Fitting the full width of a 1280px capture renders it at 0.84x, so 14px
interface text lands near 12px - unreadable, and far under the 56px floor the author prompt
required. Making that text readable needs roughly 4x scale, at which point about a quarter of the
width is inside the frame. The prompt asked for both at once (`author.ts` said to show LESS of the
image and scale further, and then that nothing may be clipped at a frame edge), so the author
oscillated: told the "Deadline Center" wordmark was cut, it shifted the crop and cut "eDimension"
instead. Job `a67b5bf6` shows QA raising the clipping twice and the scene shipping clipped anyway.

The same design also broke synchronisation: graphics animated over a static bitmap, so a highlight
and the row it referred to were unrelated objects and could never line up.

**Decision:** when an asset carries extracted text, rebuild that interface as HTML laid out for
9:16 rather than cropping the bitmap. Nothing is cropped, so nothing clips; text is text at whatever
size the frame needs; and individual rows become animatable, so a reveal can land on the row the
voiceover names.

The risk this introduces is invention - a model writing UI markup can produce a course code that was
never on screen - so reading is separated from drawing:

1. **Extract at upload.** The vision call that already captions each image also returns the
   screenshot's verbatim text, per region, each string flagged legible or not. It runs at
   `detail: "high"`, because at low detail the image is downsampled past the point where 14px text
   is readable and a confident misreading is worse than no record. Anything other than an explicit
   `legible: true` is treated as unreadable, so a model that stays silent is never taken to have
   vouched for the text.
2. **Lay out at author time.** The author receives the strings and never sees the pixels, so it has
   nothing to misread.
3. **Verify deterministically.** `checkInvention` requires every string inside a `data-ui-source`
   container to appear in that file's record. The scene's own editorial copy sits outside the
   container and stays free. It runs before the render, because a wrong digit is a string comparison
   and catching it early saves a whole HyperFrames pass.

**Alternatives considered:**
- **One-pass vision to HTML** - rejected as the default. The same pass that might read "10.016" as
  "10.018" is the one drawing it, so nothing independent catches the error. Kept as a fallback if
  reconstruction quality disappoints.
- **Scrape the connected repo for UI markup** - rejected. `src/lib/github.ts` records a deliberate
  boundary: Proof reads the README, language stats and file paths only, never source file contents.
  Reversing that is a privacy decision, not a rendering optimisation, and the app ships no privacy
  or terms page that would disclose it. It also would not generalise - most connected repos are
  backends or libraries with no UI markup, and static markup lacks the real content, which only
  exists in the screenshot.
- **Better crop rules** - rejected. The constraint is arithmetic; no wording satisfies both.

**Consequences:** assets with no extracted text (photographs, logos) keep the image-crop path
unchanged, as do briefs whose assets were uploaded before this shipped. In production the gate
caught a real invention: a scene tried to render "01.011 - Professional Practice Programme", a
string the extractor had marked illegible, and came back clean after the rejection.

**Still open:** fitting a full desktop page into 9:16 leaves interface text small. Showing fewer
rows larger - selection rather than reproduction - is the real answer and is not attempted here.

**References:** `src/lib/ui-record.ts`, `src/lib/describe-image.ts`, `src/lib/asset-caption.ts`,
`render/src/premium/invention-gate.ts`, `render/src/premium/author.ts`, PRs #34, #35.

---

## 2026-08-08: Time scene beats to the words being spoken

**Context:** the author was handed a scene's words as one string plus a duration, and nothing else
about time. The scene START was anchored to a real word boundary (`SceneSpec.anchorMs`) but nothing
inside it was, so the prompt asked for an entrance and then a beat after the midpoint, and the model
paced by arithmetic. Watching the output, things appeared before they were mentioned and several
moved at once while the voice was still on the previous point.

The transcript has carried per-word timings all along and `runPremium` already held them; they
stopped at the planner.

**Decision:** `sceneWords` slices the words spoken during a scene and rebases them onto the scene's
own clock - the same zero the author's GSAP timeline uses, so absolute transcript times would have
been unusable. A word belongs to a scene when most of it falls inside the window; counting a
straddling word in both neighbours would fire a reveal against a word the viewer already heard.

This is data the author never had rather than another rule to obey, so it applies to every render:
every video has a transcript.

**Consequences:** measured on the same brief and clips, total render time fell from 593.1s to 485.1s
and re-edits from 4 to 2 - the author needed fewer QA corrections when it could see the timings.
Beat-to-word alignment was measured by transcribing the finished videos: the word-timed cut beats a
chance baseline (median 80ms to the nearest word onset against 96ms for evenly spaced beats) where
the previous cut did not (100ms against 91ms). The margin is small and the metric is weak at ~2.9
words/second, so it is directional evidence rather than proof.

**References:** `render/src/premium/scene-words.ts`, `render/src/premium/author.ts`, PR #36.

---

## 2026-08-08: Delete the frozen-scene gate; judge motion from rendered frames

**Context:** the gate at `render/src/premium/motion-gate.ts` (added 2026-08-07, see the entry above)
decided whether a scene animated by pattern-matching GSAP calls in the authored HTML. Whether
something animates is not decidable that way. Measured against ordinary authoring styles it reported
frozen for timelines chained off `gsap.timeline()`, for chained `.from()` calls, for CSS
`@keyframes`, and for the Web Animations API - everything except the single shape it was written
against. Adding `.from`/`.fromTo` to its regex fixed one of those and left the mechanism broken.

The cost was not merely a wasted check. Every gate shares one retry budget (`MAX_QA_ITERS = 2`), the
deterministic gates run before the render and the vision QA runs after it. So two false positives
consumed every attempt, and the vision QA ran once, on the final iteration, with nothing left to
spend. On job `f68a8dab` that starved scene-4: QA's real finding - the Gradescope page cropped at
the right edge - arrived too late and shipped unfixed. A false alarm crowding out a true one is
worse than no alarm.

**Decision:** delete the gate and its tests. Nothing replaces it. The vision QA already samples five
real frames and is explicitly asked to judge motion, which answers the question from the rendered
output rather than from source.

**Alternatives considered:**
- **Extend the regex further** - rejected. Each authoring style is a new false positive, forever.
- **A pixel-delta measurement on the rendered MOV** - correct, and the replacement if QA ever proves
  to miss a genuinely frozen scene. Not built now: it would run after the render, and QA already
  looks at those frames.

**Consequences:** the render immediately after deletion used zero re-authors, against 5 in the run
before it, and total time fell to 465.8s from a 593.1s baseline. The pipeline went from five
deterministic gates to four.

**Still open:** the shared retry budget is unchanged, so any future deterministic gate can starve
the visual review the same way. Separate budgets are the general fix.

**References:** PR #36, `render/src/premium/index.ts` (the comment where the gate used to run).

---

## 2026-08-08: Ship privacy and terms, and answer signed-out API calls with JSON

**Context:** Proof reads a connected repository and records the user's face, and it shipped with no
page saying what it stores or who it goes to. That was tolerable while the only users were the two
founders. It is not tolerable pointing a university cohort at it, and it also blocked a wider
decision: reading source files from a connected repo was rejected partly because no policy page
existed that would disclose it (see the HTML-scenes entry above).

Separately, `proxy.ts` redirected signed-out callers of `/api/*` to `/login` with a 307. `fetch`
follows the redirect, the caller receives the login page's HTML with status 200, and `res.json()`
throws a parse error. The misconfigured-auth branch already excluded `/api` for exactly this reason;
the ordinary signed-out branch was missed when that was fixed. Confirmed against production before
changing anything: `POST /api/render` returned `307 -> /login`.

**Decision:**

1. Add `/privacy` and `/terms`, written plainly rather than as boilerplate, with every claim checked
   against the code: that GitHub access reads README, language stats and file paths but never source
   contents; that uploaded images live at unguessable but publicly readable URLs, so a leaked link
   opens the file; and that deleting an image deletes the object. The public-bucket disclosure is
   uncomfortable and belongs there anyway.
2. Add both routes to `PUBLIC_PREFIXES`. A policy nobody can read without an account is not a policy,
   and the person deciding whether to hand over their repository and a recording of their face needs
   to read it *before* signing in.
3. Exclude `/api/*` from the signed-out redirect so the route handlers answer with their own 401 JSON.

**Consequences:** an expired session now surfaces as a real error instead of a JSON parse failure.
A production audit of the deployed app went from 10/15 to 12/15 checks passing, with the three
remaining failures being two faults in the audit script itself and the known campus network block on
the custom domain.

**Also in this change:** the render-confirmation copy said "a few minutes" against a measured eight.
That reads as a hang, and someone who believes a job has hung re-runs it and pays twice. It now names
the number.

**References:** `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/components/legal-page.tsx`,
`src/proxy.ts`, `src/lib/render-confirmation.ts`, commits `061d4b39` and `c1eadebb`.
