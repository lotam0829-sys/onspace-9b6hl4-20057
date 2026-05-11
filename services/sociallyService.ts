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
  country_code: string;
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
  const raw = data?.data || [];
  return raw.map((item: any) => ({
    country_code: String(item.country_code),
    title: item.title || item.name || String(item.country_code),
    code: item.code || String(item.country_code),
  }));
}

export async function getPackages(providerCode: string, countryCode: string): Promise<Package[]> {
  const data = await sociallyProxy('/sms/verification/service/provider/packages', 'POST', {
    provider_code: providerCode,
    country_code: countryCode,
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
 * Loads ALL services with pre-fetched prices. Only returns services
 * that have at least one valid package with a non-zero price.
 * Uses Promise.allSettled so a single failing package fetch doesn't block others.
 */
export async function getServicesWithPrices(providerCode: string): Promise<ServiceItem[]> {
  const countries = await getCountries(providerCode);

  // Batch fetch packages in parallel — max 20 concurrent to avoid rate limits
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
      // silently skip services that failed or returned no packages
    });
  }

  return results;
}

/**
 * GET /request/sms/verification/{reference}/otp
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
