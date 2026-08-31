import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const PAYSTACK_BASE = 'https://api.paystack.co';

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const { amount, email, type, metadata: extraMeta } = await req.json();
    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY');

    // Initialize Paystack transaction — supports card + bank transfer
    const reference = `numvault_${user.id.slice(0, 8)}_${Date.now()}`;
    console.log('Initializing Paystack transaction:', reference, 'type:', type);

    // ── Split payment for number purchases ────────────────────────────────────
    // When SOCIALLY_SUBACCOUNT_CODE secret is set (after running setup-subaccount),
    // every number-purchase payment automatically routes 71.43% to Socially.ng's
    // Palmpay account at Paystack's settlement layer — no manual transfers needed.
    //
    // bearer: 'account' → main account pays the Paystack transaction fee, so
    // Socially.ng always receives the full split % of the gross charge amount.
    //
    // ⚠️  Paystack definition: percentage_charge = % the SUBACCOUNT receives.
    // Subaccount is set to 71.43% → Socially.ng receives 71.43%, NumVault keeps 28.57%.
    const sociallySubaccountCode = Deno.env.get('SOCIALLY_SUBACCOUNT_CODE');
    const isNumberPurchase = type === 'number_purchase';
    // Wallet top-ups also require a split: the customer receives the full top-up
    // amount as purchasing power, but the underlying economics must pre-allocate
    // the supplier share immediately at payment time.
    //
    // Business model (1.4× markup applies equally to wallet funding):
    //   Supplier allocation = top-up amount ÷ 1.4  → 71.43% → Socially.ng (Palmpay)
    //   NumVault allocation = top-up amount − supplier allocation → 28.57%
    //
    // ⚠️  Paystack definition: percentage_charge = % the SUBACCOUNT receives.
    // Subaccount is set to 71.43% → Socially.ng receives 71.43%, NumVault keeps 28.57%.
    // The customer's wallet is credited with the full top-up amount
    // by the webhook; the split is purely a settlement/account-funding mechanism and
    // does NOT reduce the customer's purchasing balance.
    const isWalletTopup = type === 'wallet_topup';
    // Apply the subaccount split to BOTH direct number purchases AND wallet top-ups.
    const requiresSplit = (isNumberPurchase || isWalletTopup) && !!sociallySubaccountCode;

    const initPayload: Record<string, unknown> = {
      email,
      amount: Math.round(amount * 100), // kobo
      reference,
      callback_url: 'https://numvault.app/payment/callback',
      channels: ['card', 'bank_transfer', 'ussd', 'bank'],
      metadata: {
        user_id: user.id,
        type: type || 'number_purchase',
        ...(extraMeta || {}),
      },
    };

    if (requiresSplit) {
      initPayload.subaccount = sociallySubaccountCode;
      initPayload.bearer = 'account'; // main account absorbs the Paystack fee
      console.log(`Split payment enabled for type=${type}: subaccount=${sociallySubaccountCode}`);
    } else if ((isNumberPurchase || isWalletTopup) && !sociallySubaccountCode) {
      console.warn(`SOCIALLY_SUBACCOUNT_CODE not set — split payment skipped for type=${type}`);
    }
    // ────────────────────────────────────────────────────────────────────────

    const initRes = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(initPayload),
    });

    const initData = await initRes.json();
    console.log('Init response:', JSON.stringify(initData));

    if (!initData.status) {
      return new Response(JSON.stringify({ error: initData.message || 'Failed to initialize payment' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    return new Response(JSON.stringify({
      data: {
        authorization_url: initData.data.authorization_url,
        reference: initData.data.reference,
        access_code: initData.data.access_code,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Payment init error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
