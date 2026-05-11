import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';

const supabase = getSupabaseClient();

async function invokeWithAuth(fn: string, body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const { data, error } = await supabase.functions.invoke(fn, {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const txt = await error.context?.text?.();
        if (txt) {
          try { msg = JSON.parse(txt).error || txt; } catch { msg = txt; }
        }
      } catch {}
    }
    throw new Error(msg);
  }

  return data;
}

/** Initialize a Paystack payment (card + bank transfer). Returns authorization_url + reference. */
export async function initializePayment(
  email: string,
  amount: number,
  type: string,
  metadata?: Record<string, unknown>,
) {
  return invokeWithAuth('wallet-topup', { email, amount, type, metadata });
}

/** Purchase a number after Paystack payment has been confirmed. */
export async function purchaseNumber(params: {
  provider_code: string;
  country_code: number;
  project_code: string;
  project_name: string;
  country_name: string;
  amount_paid: number;
  paystack_reference: string;
}) {
  return invokeWithAuth('purchase-number', params);
}
