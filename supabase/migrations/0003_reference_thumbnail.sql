-- Store the TikTok cover/thumbnail image so the Clips grid can render a preview.
alter table reference_videos add column if not exists thumbnail_url text;
