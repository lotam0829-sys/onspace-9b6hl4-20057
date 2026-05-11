import { getSupabaseClient } from '@/template';
import { MARKUP } from '@/constants/config';

const supabase = getSupabaseClient();

export interface Provider {
  provider_code: string;
  provider_name: string;
}

/**
 * For Server B, country_code is a SERVICE STRING (e.g. "tiktok", "whatsapp")
 * not a numeric country code. The "title" is the display name (e.g. "TikTok - USA").
 */
export interface Country {
  country_code: string;  // string for Server B (service code like "tiktok")
  title: string;
  code: string;
}

export interface Package {
  country_code: string;
  project_code: string;
  project_name: string;
  price: number;
  displayPrice: number;
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

/**
 * For Server B: returns services as "countries", where country_code = service string
 * e.g. { country_code: "tiktok", title: "TikTok - USA", code: "tiktok" }
 */
export async function getCountries(providerCode: string): Promise<Country[]> {
  const data = await sociallyProxy(`/sms/verification/provider/${providerCode}/countries`);
  const raw = data?.data || [];
  // Normalise: ensure country_code is always a string
  return raw.map((item: any) => ({
    country_code: String(item.country_code),
    title: item.title || item.name || String(item.country_code),
    code: item.code || String(item.country_code),
  }));
}

/**
 * For Server B, pass the service string as country_id (that's what the packages endpoint expects)
 */
export async function getPackages(providerCode: string, countryCode: string): Promise<Package[]> {
  const data = await sociallyProxy('/sms/verification/service/provider/packages', 'POST', {
    provider_code: providerCode,
    country_id: countryCode,
  });

  const packages: Package[] = (data?.data || []).map((pkg: any) => ({
    country_code: String(pkg.country_code),
    project_code: pkg.project_code,
    project_name: pkg.project_name,
    price: pkg.price,
    displayPrice: Math.ceil(pkg.price * MARKUP),
  }));

  return packages;
}

/**
 * GET /request/sms/verification/{reference}/otp
 * OTP is embedded in the message string: "Your OTP (0891) has been successfully received"
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
