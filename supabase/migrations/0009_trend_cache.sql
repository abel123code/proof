-- v2: shared research cache. One generic key/value table so expensive web-search
-- work is computed once and reused:
--   trends:<YYYY-MM-DD>  -> global trending topics (24h TTL, shared by all users)
--   refs:<topic>         -> mined reference patterns for a topic (per-topic TTL)

create table if not exists trend_cache (
  cache_key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_trend_cache_created on trend_cache (created_at desc);
