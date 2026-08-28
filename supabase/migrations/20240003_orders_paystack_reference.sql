-- Migration: 20240003_orders_paystack_reference
-- Purpose: Add paystack_reference column to orders for webhook idempotency guard
-- Affected tables: orders (alter)

alter table public.orders add column if not exists paystack_reference text;

-- Index for fast idempotency lookup by Paystack reference
create index if not exists orders_paystack_reference_idx
  on public.orders(paystack_reference)
  where paystack_reference is not null;
