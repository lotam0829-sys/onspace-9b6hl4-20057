import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

// One-off manual transfer trigger — fires a direct Paystack transfer to the
// Socially.ng Palmpay account using the same dynamic bank-code lookup logic
// as purchase-number.
//
// Auth: caller must supply a valid Supabase user JWT whose email matches
// ADMIN_EMAIL. No service role key is required or exposed to the client.

const ADMIN_EMAIL = 'oluwaferanmionabanjo@gmail.com';

const PAYSTACK_BASE = 'https://api.paystack.co';
const SOCIALLY_ACCOUNT_NUMBER = '6635796668';
const SOCIALLY_ACCOUNT_NAME = 'Riteweb Digital Services-Sim(Paymentpoint)';

async function getPalmpayBankCode(secretKey: string): Promise<string> {
  const res = await fetch(`${PAYSTACK_BASE}/bank?currency=NGN&perPage=200`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  });
  const data = await res.json();
  if (!data.status || !Array.isArray(data.data)) {
    throw new Error(`Paystack /bank list failed: ${JSON.stringify(data)}`);
  }
  const match = data.data.find(
    (b: { name: string; code: string }) => b.name.toLowerCase().includes('palmpay')
  );
  if (!match) throw new Error(`Palmpay not found in bank list`);
  console.log(`Resolved Palmpay bank_code: ${match.code} ("${match.name}")`);
  return match.code;
}

async function getOrCreateRecipient(secretKey: string): Promise<string> {
  const listRes = await fetch(`${PAYSTACK_BASE}/transferrecipient?perPage=100`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  });
  const listData = await listRes.json();
  if (listData.status && Array.isArray(listData.data)) {
    const existing = listData.data.find(
      (r: { details?: { account_number?: string }; recipient_code?: string }) =>
        r.details?.account_number === SOCIALLY_ACCOUNT_NUMBER
    );
    if (existing?.recipient_code) {
      console.log(`Reusing existing recipient: ${existing.recipient_code}`);
      return existing.recipient_code;
    }
  }

  const bankCode = await getPalmpayBankCode(secretKey);
  const createRes = await fetch(`${PAYSTACK_BASE}/transferrecipient`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'nuban',
      name: SOCIALLY_ACCOUNT_NAME,
      account_number: SOCIALLY_ACCOUNT_NUMBER,
      bank_code: bankCode,
      currency: 'NGN',
    }),
  });
  const createData = await createRes.json();
  console.log('Create recipient response:', JSON.stringify(createData));
  if (!createData.status || !createData.data?.recipient_code) {
    throw new Error(`Failed to create recipient: ${JSON.stringify(createData)}`);
  }
  console.log(`Created recipient: ${createData.data.recipient_code} (bank_code: ${bankCode})`);
  return createData.data.recipient_code;
}

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    // ── Auth: verify caller is the admin user ────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Verify the JWT and extract the user's email
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
      console.warn(`Unauthorized manual-transfer attempt by: ${user.email}`);
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    const body = await req.json();
    const amountNaira: number = body.amount_naira;
    const orderReference: string = body.order_reference ?? `manual_${Date.now()}`;
    const triggerReason: string = body.trigger_reason ?? 'manual_backlog_recovery';

    if (!amountNaira || amountNaira <= 0) {
      return new Response(JSON.stringify({ error: 'Provide amount_naira > 0' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
    if (!secretKey) throw new Error('PAYSTACK_SECRET_KEY not set');

    const recipientCode = await getOrCreateRecipient(secretKey);
    const amountKobo = Math.round(amountNaira * 100);
    const transferRef = `manual_${orderReference}_${Date.now()}`;

    console.log(`Firing manual transfer: ₦${amountNaira} → ${SOCIALLY_ACCOUNT_NUMBER} (ref: ${transferRef})`);

    const transferRes = await fetch(`${PAYSTACK_BASE}/transfer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: amountKobo,
        recipient: recipientCode,
        reason: `NumVault manual recovery [${triggerReason}] – order ${orderReference}`,
        reference: transferRef,
      }),
    });

    const transferData = await transferRes.json();
    console.log('Transfer response:', JSON.stringify(transferData));

    const success = !!transferData.status;
    const ref2 = transferData.data?.transfer_code || transferData.data?.reference || transferRef;
    const errMsg = success ? null : (transferData.message || JSON.stringify(transferData));

    await supabaseAdmin.from('socially_transfers').insert({
      order_reference: orderReference,
      amount_transferred: amountNaira,
      paystack_transfer_reference: ref2,
      recipient_code: recipientCode,
      status: success ? 'success' : 'failed',
      error_message: errMsg,
      trigger_reason: triggerReason,
    });

    return new Response(JSON.stringify({
      success,
      amount_naira: amountNaira,
      paystack_transfer_reference: ref2,
      recipient_code: recipientCode,
      trigger_reason: triggerReason,
      order_reference: orderReference,
      paystack_response: transferData,
      error: errMsg,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: success ? 200 : 500,
    });
  } catch (err) {
    console.error('Manual transfer error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
