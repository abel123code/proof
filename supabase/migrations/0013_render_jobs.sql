create table if not exists render_jobs (
  id uuid primary key,
  brief_id uuid not null references briefs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued',
  phase text not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  input jsonb not null,
  output_url text,
  error text,
  attempts integer not null default 0,
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_render_jobs_status_created on render_jobs(status, created_at);
create index if not exists idx_render_jobs_brief on render_jobs(brief_id, created_at desc);

alter table render_jobs enable row level security;

