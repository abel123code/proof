-- Intelligence Pipeline (moat): on-demand Exa trend research stored per project.
-- Run in the Supabase SQL editor (or via CLI) after 0001_init.sql.

-- Grounded trend research produced by the Exa Agent ("Research now").
alter table projects add column if not exists trend_research jsonb;
alter table projects add column if not exists trend_research_updated_at timestamptz;

-- Scripts reuse existing columns from 0001_init.sql:
--   content         -> grounded ScriptOutput JSON (stringified)
--   generic_content -> generic ScriptOutput JSON (stringified)
-- No additional script columns are needed.
