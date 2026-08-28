-- Migration: 20240005_pending_socially_credit
-- Purpose: Track pre-sent Socially.ng cost-recovery funds per user so wallet-funded
--          purchases can consume already-sent credit instead of triggering duplicate transfers.
--
-- Context:
--   When Socially.ng returns "Insufficient balance", purchase-number fires a cost-recovery
--   transfer immediately (71.43% of the failed payment) tagged 'insufficient_balance_recovery'.
--   If that same refunded money is later spent from the wallet on a real purchase, the normal
--   post-sale replenishment would fire again — creating a double-payment to Socially.ng.
--   This column lets us track and consume the pre-sent credit to prevent that duplication.
--
-- Affected tables: user_profiles (alter)

alter table public.user_profiles
  add column if not exists pending_socially_credit numeric(12,2) not null default 0.00;

alter table public.user_profiles
  drop constraint if exists user_profiles_pending_socially_credit_nonneg;
alter table public.user_profiles
  add constraint user_profiles_pending_socially_credit_nonneg
  check (pending_socially_credit >= 0);
