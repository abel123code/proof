-- v2: gated onboarding. Approved allowlist + per-user profiles, plus user
-- ownership + RLS on the core tables. Server code uses the service-role key
-- (which bypasses RLS); these policies protect any direct client access.

-- Approved allowlist: admin inserts rows to grant access (match by email or handle).
create table if not exists allowed_users (
  id uuid primary key default gen_random_uuid(),
  email text,
  github_username text,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_allowed_users_email on allowed_users (email) where email is not null;
create unique index if not exists idx_allowed_users_github on allowed_users (github_username) where github_username is not null;

-- Profiles: one row per approved, signed-in user (capped at 50 in app code).
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  github_username text,
  created_at timestamptz not null default now()
);

-- Ownership columns on the core tables.
alter table projects add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table briefs add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table scene_footage add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_projects_user on projects (user_id);
create index if not exists idx_briefs_user on briefs (user_id);

-- RLS: owners can touch their own rows; profiles readable by their owner.
alter table profiles enable row level security;
alter table projects enable row level security;
alter table briefs enable row level security;
alter table scene_footage enable row level security;

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for select using (auth.uid() = user_id);

drop policy if exists "own projects" on projects;
create policy "own projects" on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own briefs" on briefs;
create policy "own briefs" on briefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own footage" on scene_footage;
create policy "own footage" on scene_footage
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
