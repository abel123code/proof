-- Private-repo support via a GitHub App installation.
--
-- We deliberately store ONLY the installation id, which is NOT a credential: on its own it grants
-- nothing. Access tokens are minted on demand from the App's private key, live ~1 hour, and are
-- never written to the database or logged. The user chooses which repositories the installation can
-- see in GitHub's own UI and can revoke it there at any time, so Proof can never hold blanket access
-- to someone's private code. (An OAuth App with the `repo` scope was rejected for exactly that
-- reason: it is read+write across every private repo the user owns.)
--
-- Numbering note: 0015 is reserved by the in-app bug-reports branch and 0016 is scene_reports, so
-- this is 0017 to avoid a collision whichever order those land.
alter table profiles add column if not exists github_installation_id bigint;

comment on column profiles.github_installation_id is
  'GitHub App installation id for this user, or null when not connected. Not a secret: installation '
  'access tokens are minted on demand from the app private key and never persisted.';

-- profiles is already RLS-enabled with an "own profile" policy (0007_auth_profiles.sql) and all
-- server access goes through the service role, so a new column inherits that posture.
