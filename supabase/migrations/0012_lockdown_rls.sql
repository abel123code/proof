-- Security hardening: enable RLS on every remaining public table.
--
-- Tables created in the early migrations (0001-0009) never had RLS turned on.
-- Any public-schema table WITHOUT RLS is reachable by the public `anon` key via
-- PostgREST (https://<ref>.supabase.co/rest/v1/<table>), so those tables were
-- effectively world-readable/writable. Most severe: `allowed_users` leaked
-- approved emails AND let anyone insert themselves to bypass the approval gate.
--
-- The app never touches these tables from the browser - all data access goes
-- through server API routes using the service_role key, which BYPASSES RLS.
-- So enabling RLS with NO policies is a pure deny-all for public clients and
-- leaves the server (and existing owner-scoped tables) working unchanged.

alter table allowed_users   enable row level security;
alter table reference_videos enable row level security;
alter table scripts         enable row level security;
alter table captures        enable row level security;
alter table transcripts     enable row level security;
alter table renders         enable row level security;
alter table trend_cache     enable row level security;
