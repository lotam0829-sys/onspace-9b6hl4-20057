import { getSupabaseClient } from '@/template';
import { MARKUP } from '@/constants/config';

const supabase = getSupabaseClient();

export interface Provider {
  provider_code: string;
  provider_name: string;
}

export interface Country {
  country_id: number;
  title: string;
  code: string;
}

export interface Package {
  country_id: number;
  project_id: number;
  project_code: string;
  project_name: string;
  price: number; // raw price from API
  displayPrice: number; // with 40% markup
}

async function sociallyProxy(path: string, method = 'GET', body?: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await supabase.functions.invoke('socially-proxy', {
    body: { path, method, body },
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (res.error) {
    let msg = res.error.message;
    try {
      const txt = await (res.error as any).context?.text?.();
      if (txt) msg = txt;
    } catch {}
    throw new Error(msg);
  }

  return res.data;
}

export async function getProviders(): Promise<Provider[]> {
  const data = await sociallyProxy('/sms/verification/providers');
  return data?.data || [];
}

export async function getCountries(providerCode: string): Promise<Country[]> {
  const data = await sociallyProxy(`/sms/verification/provider/${providerCode}/countries`);
  return data?.data || [];
}

export async function getPackages(providerCode: string, countryId: number): Promise<Package[]> {
  const data = await sociallyProxy('/sms/verification/service/provider/packages', 'POST', {
    provider_code: providerCode,
    country_id: countryId,
  });

  const packages: Package[] = (data?.data || []).map((pkg: any) => ({
    ...pkg,
    displayPrice: Math.ceil(pkg.price * MARKUP),
  }));

  return packages;
}

export async function getOTP(reference: string): Promise<string | null> {
  try {
    const data = await sociallyProxy(`/sms/verification/otp?reference=${reference}`);
    return data?.data?.otp || data?.data?.code || null;
  } catch {
    return null;
  }
}
