-- Per-scene footage: each scene of a brief can have one uploaded/recorded clip.
create table if not exists scene_footage (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references briefs(id) on delete cascade,
  scene_index int not null,
  url text not null,
  storage_path text,
  created_at timestamptz default now(),
  unique (brief_id, scene_index)
);

-- Public storage bucket for the footage files. Uploads happen server-side with
-- the service-role key (bypasses RLS); the bucket is public so clips are viewable.
insert into storage.buckets (id, name, public)
values ('footage', 'footage', true)
on conflict (id) do nothing;
