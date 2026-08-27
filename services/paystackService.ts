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
    let refunded = false;
    let refundAmount: number | undefined;
    if (error instanceof FunctionsHttpError) {
      try {
        const txt = await error.context?.text?.();
        if (txt) {
          try {
            const parsed = JSON.parse(txt);
            msg = parsed.error || txt;
            refunded = !!parsed.refunded;
            refundAmount = parsed.refund_amount;
          } catch { msg = txt; }
        }
      } catch {}
    }
    const err: any = new Error(msg);
    err.refunded = refunded;
    err.refund_amount = refundAmount;
    throw err;
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

/** Purchase a number. Pass paystack_reference after a card/bank payment, or use_wallet: true to spend from wallet balance. */
export async function purchaseNumber(params: {
  provider_code: string;
  country_code: string;   // string for Server B (service code like "tiktok")
  project_code: string;
  project_name: string;
  country_name: string;
  amount_paid: number;
  paystack_reference?: string;
  use_wallet?: boolean;
}) {
  return invokeWithAuth('purchase-number', params);
}
