-- Track the Zo render for a brief: the async job id, its latest status, and the
-- finished edited MP4 (re-uploaded to our Storage so it survives the ephemeral Zo box).
alter table briefs add column if not exists render_job_id text;
alter table briefs add column if not exists render_status text;
alter table briefs add column if not exists render_url text;
