-- =====================================================================
-- Migration 002: one live entry per bill (additive: a new partial unique index)
-- POST /receipts/{id}/save already refuses a second save (409 already_saved), but two taps that
-- arrive at the same moment could both pass that check. This index makes the database refuse the
-- second insert. Voided entries don't count, so a bill can be saved again after Undo.
-- Safe to run more than once.
-- =====================================================================
create unique index if not exists entries_one_live_per_receipt
  on entries (receipt_id)
  where receipt_id is not null and status <> 'voided';
