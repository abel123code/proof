-- In-app bug reports for the founding-user beta.
-- Users hit "report a bug" in the studio header; we store their message plus the
-- diagnostic context the client already has (briefId, renderJobId, renderStatus,
-- the last render error, url, browser) so a report is actionable without a
-- back-and-forth. Admins triage them on /admin next to the access requests.

create table if not exists bug_reports (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: the local dev user (DEV_USER_ID) does not exist in auth.users, and
  -- we would rather keep an anonymous report than lose it to an FK violation.
  user_id uuid references auth.users(id) on delete set null,
  email text,
  message text not null,
  -- Whatever the client could attach: { url, briefId, projectId, renderJobId,
  -- renderStatus, renderUrl, lastError, userAgent }. Shape is intentionally loose.
  context jsonb,
  -- open | closed
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists idx_bug_reports_created_at
  on bug_reports (created_at desc);
create index if not exists idx_bug_reports_status
  on bug_reports (status);

-- Server code uses the service-role key (bypasses RLS). Enable RLS with no
-- policies so no direct client access is ever possible.
alter table bug_reports enable row level security;
