-- Refunds for renders that failed after the credits were already spent.
--
-- Credits are reserved before the job is handed to the worker and refunded only if the
-- worker never accepts it. Once accepted, ANY later failure (ffmpeg segfault, OOM, a
-- Railway restart, an OpenAI timeout) burned the full render cost with no refund. That is
-- 80 of a user's 1000 lifetime credits for an outage that was ours, not theirs, and the
-- only signal was a toast that disappeared.
--
-- The refund has to fire exactly once. The browser polls the job every 4 seconds, and a
-- user can have two tabs open, so anything that refunds "when someone notices the
-- failure" pays out repeatedly. This column is the idempotency guard: the refund is
-- claimed with a conditional update (... where refunded_at is null), so exactly one caller
-- can win regardless of how many observe the failure.

alter table render_jobs
  add column if not exists refunded_at timestamptz;

-- Partial index: the only query is "has this job been refunded yet", and unrefunded rows
-- are the small minority worth indexing.
create index if not exists idx_render_jobs_unrefunded
  on render_jobs (id)
  where refunded_at is null;
