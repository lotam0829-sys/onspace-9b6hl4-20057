-- Migration: create debit_wallet RPC
-- Purpose: Atomic wallet debit — prevents double-spend on concurrent purchase requests.
-- Used by: supabase/functions/purchase-number (wallet payment path)
--
-- The function does a single UPDATE ... WHERE wallet_balance >= p_amount RETURNING wallet_balance.
-- If no rows are matched (balance too low or user not found), it raises INSUFFICIENT_BALANCE
-- so the caller never sees a silent zero-rows result misread as success.

create or replace function public.debit_wallet(p_user_id uuid, p_amount numeric)
returns numeric
language plpgsql
security definer
as $$
declare
  v_new_balance numeric;
begin
  update user_profiles
  set wallet_balance = wallet_balance - p_amount
  where id = p_user_id
    and wallet_balance >= p_amount
  returning wallet_balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  return v_new_balance;
end;
$$;

-- Grant execute to authenticated users (for direct RPC calls from client if ever needed)
-- and to service_role (used by Edge Functions via supabaseAdmin)
grant execute on function public.debit_wallet(uuid, numeric) to authenticated;
grant execute on function public.debit_wallet(uuid, numeric) to service_role;
