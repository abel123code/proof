-- v2: per-user usage quotas. Rate-limited research (rolling daily window) and a
-- hard lifetime cap on video edits (default 3).

create table if not exists usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  research_runs int not null default 0,
  research_window_start timestamptz not null default now(),
  edits_used int not null default 0,
  updated_at timestamptz not null default now()
);

alter table usage enable row level security;

drop policy if exists "own usage" on usage;
create policy "own usage" on usage
  for select using (auth.uid() = user_id);
