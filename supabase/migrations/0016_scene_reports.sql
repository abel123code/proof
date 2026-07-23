-- Auditable per-scene QA reports for a premium render.
--
-- The premium path (runPremium) now returns a SceneReport per scene — verdict (clean | flagged |
-- base_fallback), the tagged reasons (safety | subjective), and attempt count — instead of silently
-- omitting rejected scenes. Persisting it here lets the studio show the user WHY each scene shipped
-- the way it did and offer a per-scene re-render. See DECISIONS.md 2026-07-23 (auditable QA advisor).
--
-- Shape (array of): { sceneId, anchorMs, durMs, intent, verdict, shipped, attempts,
--                     issues: [{ text, kind }] }
alter table briefs add column if not exists scene_reports jsonb;

comment on column briefs.scene_reports is
  'Per-scene QA audit for the latest premium render: SceneReport[] (verdict + tagged reasons). '
  'Written server-side by the render worker; read by the studio review UI.';

-- No RLS policy added on purpose: briefs is deny-all under 0012_lockdown_rls (all access is
-- server-side via the service role, which bypasses RLS). A new column inherits that posture.
