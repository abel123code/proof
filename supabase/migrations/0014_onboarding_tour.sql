alter table profiles
  add column if not exists onboarding_state text not null default 'not_started',
  add column if not exists onboarding_version integer not null default 1,
  add column if not exists onboarding_completed_at timestamptz;

alter table profiles
  drop constraint if exists profiles_onboarding_state_check;

alter table profiles
  add constraint profiles_onboarding_state_check
  check (onboarding_state in ('not_started', 'completed', 'skipped'));
