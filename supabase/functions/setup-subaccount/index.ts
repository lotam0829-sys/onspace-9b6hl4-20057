import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

// One-time admin function to create a Paystack subaccount for Socially.ng's Palmpay account.
// Idempotent: if a subaccount already exists for account number 6635796668, returns existing code.
//
// percentage_charge: 28.57
//   → Per Paystack docs: "percentage_charge represents the % the MAIN account keeps"
//   → Main account keeps 28.57%, Socially.ng subaccount receives 71.43%
//   → This matches the current Transfer-based cost-recovery ratio (revenue / 1.4 = 71.43%)
//
// Auth: valid user JWT required, email must match ADMIN_EMAIL.

const ADMIN_EMAIL = 'oluwaferanmionabanjo@gmail.com';
const PAYSTACK_BASE = 'https://api.paystack.co';
const SOCIALLY_ACCOUNT_NUMBER = '6635796668';
const SOCIALLY_ACCOUNT_NAME = 'Riteweb Digital Services-Sim(Paymentpoint)';
// 71.43% to subaccount = main account keeps 28.57%
const MAIN_ACCOUNT_PERCENTAGE = 28.57;

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    // ── Auth: verify caller is admin ────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: { user }, error: authErr } = await supabaseClient.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }
    if (user.email !== ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
    if (!secretKey) throw new Error('PAYSTACK_SECRET_KEY not set');

    // ── Idempotency: check if subaccount already exists ─────────────────────
    const listRes = await fetch(`${PAYSTACK_BASE}/subaccount?perPage=100`, {
      headers: { 'Authorization': `Bearer ${secretKey}` },
    });
    const listData = await listRes.json();

    if (listData.status && Array.isArray(listData.data)) {
      const existing = listData.data.find(
        (s: { account_number?: string; subaccount_code?: string }) =>
          s.account_number === SOCIALLY_ACCOUNT_NUMBER,
      );
      if (existing?.subaccount_code) {
        console.log(`Subaccount already exists: ${existing.subaccount_code}`);
        return new Response(JSON.stringify({
          success: true,
          already_existed: true,
          subaccount_code: existing.subaccount_code,
          account_number: SOCIALLY_ACCOUNT_NUMBER,
          percentage_charge: existing.percentage_charge,
          note: `percentage_charge=${existing.percentage_charge} means main account keeps ${existing.percentage_charge}%, Socially.ng receives ${(100 - Number(existing.percentage_charge)).toFixed(2)}%`,
          next_step: `Add this as a Supabase secret named SOCIALLY_SUBACCOUNT_CODE with value: ${existing.subaccount_code}`,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Resolve Palmpay's settlement bank code ───────────────────────────────
    const banksRes = await fetch(`${PAYSTACK_BASE}/bank?currency=NGN&perPage=200`, {
      headers: { 'Authorization': `Bearer ${secretKey}` },
    });
    const banksData = await banksRes.json();
    if (!banksData.status || !Array.isArray(banksData.data)) {
      throw new Error(`Failed to fetch bank list: ${JSON.stringify(banksData)}`);
    }
    const palmpay = banksData.data.find(
      (b: { name: string; code: string }) => b.name.toLowerCase().includes('palmpay'),
    );
    if (!palmpay) throw new Error('Palmpay not found in Paystack bank list');
    console.log(`Resolved Palmpay: "${palmpay.name}" code=${palmpay.code}`);
    // ────────────────────────────────────────────────────────────────────────

    // ── Create subaccount ────────────────────────────────────────────────────
    // percentage_charge = what the MAIN account keeps (per Paystack docs).
    // We want Socially.ng to receive 71.43% → main keeps 28.57%.
    const createRes = await fetch(`${PAYSTACK_BASE}/subaccount`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        business_name: SOCIALLY_ACCOUNT_NAME,
        settlement_bank: palmpay.code,
        account_number: SOCIALLY_ACCOUNT_NUMBER,
        percentage_charge: MAIN_ACCOUNT_PERCENTAGE,
        description: 'NumVault — Socially.ng cost-recovery split (71.43% of each number purchase)',
        primary_contact_email: ADMIN_EMAIL,
      }),
    });
    const createData = await createRes.json();
    console.log('Create subaccount response:', JSON.stringify(createData));

    if (!createData.status || !createData.data?.subaccount_code) {
      return new Response(JSON.stringify({
        success: false,
        error: createData.message || 'Failed to create subaccount',
        paystack_response: createData,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const subaccountCode = createData.data.subaccount_code;
    console.log(`Subaccount created: ${subaccountCode} (percentage_charge: ${MAIN_ACCOUNT_PERCENTAGE})`);

    return new Response(JSON.stringify({
      success: true,
      already_existed: false,
      subaccount_code: subaccountCode,
      account_number: SOCIALLY_ACCOUNT_NUMBER,
      bank_code: palmpay.code,
      bank_name: palmpay.name,
      percentage_charge: MAIN_ACCOUNT_PERCENTAGE,
      note: `percentage_charge=${MAIN_ACCOUNT_PERCENTAGE} means main account keeps ${MAIN_ACCOUNT_PERCENTAGE}%, Socially.ng receives ${(100 - MAIN_ACCOUNT_PERCENTAGE).toFixed(2)}%`,
      next_step: `Add this as a Supabase secret named SOCIALLY_SUBACCOUNT_CODE with value: ${subaccountCode}`,
      paystack_response: createData.data,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    // ────────────────────────────────────────────────────────────────────────

  } catch (err) {
    console.error('setup-subaccount error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
