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

export async function initializePayment(email: string, amount: number, type: string) {
  return invokeWithAuth('wallet-topup', { email, amount, type });
}

export async function chargeWithSavedCard(email: string, amount: number, authCode: string, type: string) {
  return invokeWithAuth('wallet-topup', { email, amount, auth_code: authCode, type });
}

export async function initializeSaveCard(email: string) {
  return invokeWithAuth('save-card', { email });
}

export async function purchaseNumber(params: {
  provider_code: string;
  country_id: number;
  project_id: number;
  project_name: string;
  country_name: string;
  amount_paid: number;
}) {
  return invokeWithAuth('purchase-number', params);
}
