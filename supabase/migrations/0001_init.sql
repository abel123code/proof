-- Reverse-Engineer schema. Run in the Supabase SQL editor (or via CLI).
-- Phases 1-3 use projects + reference_videos; the rest are created up-front
-- so later phases need no new migration.

create extension if not exists "pgcrypto";

-- Projects: a connected GitHub repo + its AI understanding (Phase 2).
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  repo_url text not null,
  name text not null,
  understanding jsonb,
  created_at timestamptz not null default now()
);

-- Reference videos: the pre-baked Apify pool (Phase 3a) + saved Gemini structure (Phase 3b).
create table if not exists reference_videos (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  download_url text,
  author text,
  caption text,
  views bigint,
  likes bigint,
  matched_query text,
  status text not null default 'pending',
  structure jsonb,
  created_at timestamptz not null default now()
);

-- Briefs: the blend of project understanding + a reference structure (Phase 4).
create table if not exists briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference_video_id uuid references reference_videos(id) on delete set null,
  content jsonb,
  created_at timestamptz not null default now()
);

-- Scripts: film-ready script + keyword flags, plus a generic baseline (Phase 5).
create table if not exists scripts (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references briefs(id) on delete cascade,
  content text,
  keyword_flags jsonb,
  generic_content text,
  created_at timestamptz not null default now()
);

-- Captures: recorded/uploaded footage for a script (Phase 6).
create table if not exists captures (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references scripts(id) on delete cascade,
  video_url text,
  created_at timestamptz not null default now()
);

-- Transcripts: word-level Whisper output for a capture (Phase 7).
create table if not exists transcripts (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references captures(id) on delete cascade,
  words jsonb,
  created_at timestamptz not null default now()
);

-- Renders: the final MP4 job (Phase 8).
create table if not exists renders (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcripts(id) on delete cascade,
  mp4_url text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists idx_reference_videos_status on reference_videos(status);
create index if not exists idx_briefs_project on briefs(project_id);
