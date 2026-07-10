-- Admin roles + access requests.
-- Admins are marked by the is_admin flag on their profile (set manually via SQL).
-- access_requests captures people who signed in but weren't allowlisted, so an
-- admin can approve/reject them from the /admin page instead of writing SQL.

alter table profiles add column if not exists is_admin boolean not null default false;

create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  email text,
  github_username text,
  -- pending | approved | rejected
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create unique index if not exists idx_access_requests_email
  on access_requests (email) where email is not null;

-- Server code uses the service-role key (bypasses RLS). Enable RLS with no
-- policies so no direct client access is ever possible.
alter table access_requests enable row level security;
