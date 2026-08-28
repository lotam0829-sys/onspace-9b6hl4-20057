-- Migration: 20240004_socially_transfers_trigger_reason
-- Purpose: Add trigger_reason column to socially_transfers to distinguish
--          normal post-sale replenishments from insufficient-balance recovery transfers.
-- Affected tables: socially_transfers (alter)
--
-- Values:
--   'post_sale_recovery'           — normal: fired after every successful purchase
--   'insufficient_balance_recovery'— fired when Socially.ng returns "Insufficient balance"
--                                    so the failed transaction's cash is immediately
--                                    cycled back into the reserve before it settles elsewhere

alter table public.socially_transfers add column if not exists trigger_reason text;
