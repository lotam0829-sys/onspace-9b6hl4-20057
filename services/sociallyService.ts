import { getSupabaseClient } from '@/template';
import { MARKUP } from '@/constants/config';

const supabase = getSupabaseClient();

export interface Provider {
  provider_code: string;
  provider_name: string;
}

export interface Country {
  country_code: number;  // API field name
  title: string;
  code: string;
}

export interface Package {
  country_code: number;
  project_code: string;   // e.g. "tk", "tg"
  project_name: string;   // e.g. "TikTok/Douyin"
  price: number;          // raw price from API (Naira)
  displayPrice: number;   // with 40% markup
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

export async function getPackages(providerCode: string, countryCode: number): Promise<Package[]> {
  const data = await sociallyProxy('/sms/verification/service/provider/packages', 'POST', {
    provider_code: providerCode,
    country_id: countryCode,  // packages endpoint still uses country_id as field name
  });

  const packages: Package[] = (data?.data || []).map((pkg: any) => ({
    country_code: pkg.country_code,
    project_code: pkg.project_code,
    project_name: pkg.project_name,
    price: pkg.price,
    displayPrice: Math.ceil(pkg.price * MARKUP),
  }));

  return packages;
}

/**
 * Calls GET /request/sms/verification/{reference}/otp
 * This both triggers and retrieves the OTP.
 * OTP is embedded in the message: "Your OTP (0891) has been successfully received"
 */
export async function getOTP(reference: string): Promise<{ otp: string | null; mobile_number: string | null }> {
  try {
    const data = await sociallyProxy(`/request/sms/verification/${reference}/otp`);
    const message: string = data?.message || '';
    const otpMatch = message.match(/\((\d{4,8})\)/);
    const otp = otpMatch ? otpMatch[1] : null;
    const mobileNumber = data?.data?.mobile_number || null;
    return { otp, mobile_number: mobileNumber };
  } catch {
    return { otp: null, mobile_number: null };
  }
}
