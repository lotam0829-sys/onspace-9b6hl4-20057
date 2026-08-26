import { getSupabaseClient } from '@/template';
import { MARKUP } from '@/constants/config';

const supabase = getSupabaseClient();

export interface Provider {
  provider_code: string;
  provider_name: string;
}

/**
 * For Server B: country_code is a SERVICE STRING (e.g. "tiktok").
 * For Server A: country_code is a NUMERIC STRING (e.g. "88") representing a real country.
 */
export interface Country {
  country_code: string;   // string for both — numeric string for A, service string for B
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

/** A service item with pre-loaded price — only services with valid prices are included. */
export interface ServiceItem {
  country_code: string;
  title: string;
  code: string;
  package: Package;
  category: ServiceCategory;
}

export type ServiceCategory =
  | 'All'
  | 'Social'
  | 'Messaging'
  | 'Finance'
  | 'Shopping'
  | 'Other';

// ── Category detection ──────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<ServiceCategory, string[]> = {
  All: [],
  Social: [
    'tiktok', 'instagram', 'facebook', 'twitter', 'x.com', 'snapchat', 'youtube',
    'pinterest', 'linkedin', 'reddit', 'tumblr', 'vk', 'ok.ru', 'weibo', 'douyin',
    'clubhouse', 'discord', 'twitch',
  ],
  Messaging: [
    'whatsapp', 'telegram', 'signal', 'viber', 'line', 'wechat', 'kakao',
    'skype', 'imo', 'zalo', 'kik', 'textme', 'textplus', 'talkatone',
  ],
  Finance: [
    'paypal', 'binance', 'coinbase', 'cashapp', 'cash app', 'stripe', 'revolut',
    'wise', 'transferwise', 'crypto', 'bitcoin', 'blockchain', 'bybit', 'okx',
    'kraken', 'kucoin', 'huobi', 'bank', 'mpesa', 'paga', 'chipper',
  ],
  Shopping: [
    'amazon', 'alibaba', 'aliexpress', 'ebay', 'shopify', 'etsy',
    'wish', 'shein', 'jumia', 'konga',
  ],
  Other: [],
};

export function detectCategory(title: string): ServiceCategory {
  const lower = title.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [ServiceCategory, string[]][]) {
    if (cat === 'All' || cat === 'Other') continue;
    if (keywords.some((kw) => lower.includes(kw))) return cat;
  }
  return 'Other';
}

// ── Proxy helper ────────────────────────────────────────────────────────────

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

// ── API functions ────────────────────────────────────────────────────────────

export async function getProviders(): Promise<Provider[]> {
  const data = await sociallyProxy('/sms/verification/providers');
  return data?.data || [];
}

export async function getCountries(providerCode: string): Promise<Country[]> {
  const data = await sociallyProxy(`/sms/verification/provider/${providerCode}/countries`);
  // API may return array directly OR under data key
  const raw: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return raw
    .filter((item: any) => item && (item.country_code !== undefined || item.id !== undefined))
    .map((item: any) => ({
      // Prefer numeric id as country_code for Server A, fallback to country_code field
      country_code: String(item.country_code ?? item.id ?? ''),
      title: item.title || item.name || item.country_name || String(item.country_code ?? item.id ?? ''),
      code: item.code || item.iso_code || item.flag_code || String(item.country_code ?? item.id ?? ''),
    }))
    .filter((c) => c.country_code !== '');
}

/**
 * Get packages for a provider + country.
 * For Server B: countryCode is a service string (e.g. "tiktok")
 * For Server A: countryCode is a numeric string (e.g. "88")
 * The packages endpoint always uses the field name "country_code".
 */
export async function getPackages(providerCode: string, countryCode: string): Promise<Package[]> {
  const data = await sociallyProxy('/sms/verification/service/provider/packages', 'POST', {
    provider_code: providerCode,
    country_code: countryCode,
  });

  // API may return array directly OR under data/packages/result key
  const raw: any[] =
    Array.isArray(data) ? data :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.packages) ? data.packages :
    Array.isArray(data?.result) ? data.result :
    [];

  const packages: Package[] = raw
    .filter((pkg: any) => pkg && (pkg.project_code || pkg.project_name))
    .map((pkg: any) => {
      const rawPrice = Number(pkg.price ?? pkg.cost ?? pkg.amount ?? 0);
      return {
        country_code: String(pkg.country_code ?? countryCode),
        project_code: String(pkg.project_code ?? pkg.id ?? ''),
        project_name: String(pkg.project_name ?? pkg.name ?? pkg.title ?? ''),
        price: rawPrice,
        displayPrice: rawPrice > 0 ? Math.ceil(rawPrice * MARKUP) : 0,
      };
    });

  return packages;
}

/**
 * For Server B: loads ALL services (country list IS the service list) with pre-fetched prices.
 * Batch-fetches packages in parallel, returns only items with a valid price > 0.
 */
export async function getServicesWithPrices(providerCode: string): Promise<ServiceItem[]> {
  const countries = await getCountries(providerCode);

  const BATCH = 20;
  const results: ServiceItem[] = [];

  for (let i = 0; i < countries.length; i += BATCH) {
    const batch = countries.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map((country) => getPackages(providerCode, country.country_code))
    );

    settled.forEach((result, idx) => {
      const country = batch[idx];
      if (result.status === 'fulfilled') {
        const pkgs = result.value.filter((p) => p.price > 0 && p.displayPrice > 0);
        if (pkgs.length > 0) {
          results.push({
            country_code: country.country_code,
            title: country.title,
            code: country.code,
            package: pkgs[0],
            category: detectCategory(country.title),
          });
        }
      }
    });
  }

  return results;
}

/**
 * For Server A: given a country, load all available packages (platforms).
 * Returns packages with displayPrice applied.
 */
export async function getPackagesForCountry(providerCode: string, countryCode: string): Promise<Package[]> {
  const pkgs = await getPackages(providerCode, countryCode);
  return pkgs.filter((p) => p.price > 0 && p.displayPrice > 0);
}

/**
 * GET /request/sms/verification/{reference}/otp
 * Parses the OTP from the message string (e.g. "Your OTP (1234) has been received").
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
