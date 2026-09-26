-- =====================================================================
-- Migration: lock down shop_members self-updates
-- Fixes: the `member_self` policy allowed a user to update ANY column of
-- their own shop_members row, including shop_id, user_id and role — so a
-- user could move themselves into another shop or promote themselves to
-- owner without an invite code. Run this once against the live project.
-- =====================================================================

create or replace function block_membership_tamper() returns trigger
language plpgsql as $$
begin
  if new.shop_id <> old.shop_id or new.user_id <> old.user_id or new.role <> old.role then
    raise exception 'shop_id, user_id and role cannot be changed by the member themselves';
  end if;
  return new;
end $$;

drop trigger if exists shop_members_no_tamper on shop_members;
create trigger shop_members_no_tamper
  before update on shop_members
  for each row execute function block_membership_tamper();

-- member_self policy still allows the update to reach the trigger (for lang/tts_voice edits);
-- the trigger is what actually blocks the sensitive columns. No policy change needed.
