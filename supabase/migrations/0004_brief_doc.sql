-- Stage 04 reworked into a scene-by-scene content brief with an info-gap Q&A step.
-- Store the structured brief doc, the AI's gap questions, and the creator's answers.
alter table briefs add column if not exists doc jsonb;
alter table briefs add column if not exists gaps jsonb;
alter table briefs add column if not exists answers jsonb;
