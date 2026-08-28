-- Migration: 20240002_socially_transfers
-- Purpose: Log every auto-transfer attempt to Socially.ng's Palmpay funding account
-- Affected tables: socially_transfers (new)

create table if not exists public.socially_transfers (
  id uuid primary key default gen_random_uuid(),
  order_reference text not null,
  amount_transferred numeric(12,2) not null,
  paystack_transfer_reference text,
  recipient_code text,
  status text not null default 'pending', -- 'success' | 'failed' | 'pending'
  error_message text,
  created_at timestamp with time zone not null default now()
);

-- RLS: service role only — no user-facing access needed
alter table public.socially_transfers enable row level security;

-- Service role bypasses RLS by default.
-- No anon/authenticated policies intentionally — this is an internal audit log.
