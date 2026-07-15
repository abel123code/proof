-- Per-brief assets folder for the premium (bespoke-scene) render path: real product
-- screenshots + logo(s) + brand color + motif, so scenes embed the actual product UI
-- instead of generic text cards. Stored as one jsonb blob on the brief so it survives
-- brief re-drafts (unlike nesting it inside `doc`, which is regenerated). The image files
-- live in the existing public `footage` bucket under an `assets/<briefId>/` prefix.
alter table briefs add column if not exists assets jsonb;
