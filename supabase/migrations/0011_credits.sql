-- Unified credit wallet. Replaces the split research-per-day + lifetime-edit
-- caps with a single lifetime balance per user. Each paid AI/render action
-- deducts a tuned amount (see src/lib/pricing.ts). Charge-upfront + refund on
-- failure, so a burst of parallel requests can't run expensive calls for free.

-- Fallback default only; getOrCreateUsage seeds the real balance from
-- STARTING_CREDITS (env FREE_CREDITS, default 2000) on insert.
alter table usage add column if not exists credits_total int not null default 2000;
alter table usage add column if not exists credits_used  int not null default 0;

-- Atomic reserve: deducts amt ONLY if it stays within the balance. Returns the
-- remaining credits, or NULL when it would overspend (or the row is missing).
-- Callers must ensure the usage row exists first (getOrCreateUsage).
create or replace function spend_credits(p_user uuid, p_amt int)
returns int
language plpgsql
as $$
declare
  v_remaining int;
begin
  update usage
     set credits_used = credits_used + p_amt,
         updated_at = now()
   where user_id = p_user
     and credits_used + p_amt <= credits_total
  returning credits_total - credits_used into v_remaining;
  return v_remaining; -- NULL if no row was updated (insufficient / missing)
end;
$$;

-- Give back reserved credits when the downstream work fails. Clamps at 0.
create or replace function refund_credits(p_user uuid, p_amt int)
returns void
language plpgsql
as $$
begin
  update usage
     set credits_used = greatest(0, credits_used - p_amt),
         updated_at = now()
   where user_id = p_user;
end;
$$;

grant execute on function spend_credits(uuid, int) to service_role;
grant execute on function refund_credits(uuid, int) to service_role;
