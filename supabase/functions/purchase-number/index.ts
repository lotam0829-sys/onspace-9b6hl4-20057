import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const PAYSTACK_BASE = 'https://api.paystack.co';

// ── Socially.ng funding account (Palmpay) ──────────────────────────────────
// Transfers are fired non-blocking after every successful purchase.
// Cost = revenue ÷ 1.4  (71.43% of amount paid, i.e. the pre-markup price).
// Recipient code is resolved once and cached in-memory for the function lifetime.
const SOCIALLY_BANK_CODE = '999111';   // Palmpay bank code on Paystack
const SOCIALLY_ACCOUNT_NUMBER = '6635796668';
const SOCIALLY_ACCOUNT_NAME = 'Riteweb Digital Services-Sim(Paymentpoint)';
let cachedRecipientCode: string | null = null;

/**
 * Resolve or create a Paystack Transfer Recipient for the Socially.ng account.
 * Uses a simple in-memory cache so we only hit Paystack's API once per
 * cold-start of this function instance.
 */
async function getSociallyRecipientCode(secretKey: string): Promise<string> {
  if (cachedRecipientCode) return cachedRecipientCode;

  // Try to list existing recipients and find the one matching our account number
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
      cachedRecipientCode = existing.recipient_code;
      return cachedRecipientCode!;
    }
  }

  // Not found — create it
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
      bank_code: SOCIALLY_BANK_CODE,
      currency: 'NGN',
    }),
  });
  const createData = await createRes.json();
  if (!createData.status || !createData.data?.recipient_code) {
    throw new Error(`Failed to create transfer recipient: ${JSON.stringify(createData)}`);
  }
  cachedRecipientCode = createData.data.recipient_code;
  return cachedRecipientCode!;
}

/**
 * Fire a non-blocking Paystack transfer to the Socially.ng funding account.
 * Amount is the cost portion (revenue ÷ 1.4). Logs to socially_transfers.
 * NEVER throws — failures are logged only and do not affect the purchase flow.
 */
async function fireSociallyTransfer(
  supabaseAdmin: ReturnType<typeof createClient>,
  orderReference: string,
  revenueAmount: number,
  secretKey: string,
): Promise<void> {
  // Cost = revenue ÷ 1.4 (removes 40% markup), rounded down to nearest kobo
  const costNaira = Math.floor((revenueAmount / 1.4) * 100) / 100;
  const amountKobo = Math.round(costNaira * 100); // Paystack uses kobo
  const transferRef = `st_${orderReference}_${Date.now()}`;
  let recipientCode: string | null = null;
  let transferRef2: string | null = null;

  try {
    recipientCode = await getSociallyRecipientCode(secretKey);

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
        reason: `NumVault cost recovery – order ${orderReference}`,
        reference: transferRef,
      }),
    });
    const transferData = await transferRes.json();
    console.log('Socially transfer response:', JSON.stringify(transferData));

    if (transferData.status) {
      transferRef2 = transferData.data?.transfer_code || transferData.data?.reference || transferRef;
      await supabaseAdmin.from('socially_transfers').insert({
        order_reference: orderReference,
        amount_transferred: costNaira,
        paystack_transfer_reference: transferRef2,
        recipient_code: recipientCode,
        status: 'success',
      });
      console.log(`Socially transfer SUCCESS: ₦${costNaira} → ${SOCIALLY_ACCOUNT_NUMBER} (ref: ${transferRef2})`);
    } else {
      const errMsg = transferData.message || JSON.stringify(transferData);
      await supabaseAdmin.from('socially_transfers').insert({
        order_reference: orderReference,
        amount_transferred: costNaira,
        paystack_transfer_reference: transferRef,
        recipient_code: recipientCode ?? 'unknown',
        status: 'failed',
        error_message: errMsg,
      });
      console.error(`Socially transfer FAILED (logged): ${errMsg}`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    try {
      await supabaseAdmin.from('socially_transfers').insert({
        order_reference: orderReference,
        amount_transferred: costNaira,
        paystack_transfer_reference: transferRef,
        recipient_code: recipientCode ?? 'unknown',
        status: 'failed',
        error_message: errMsg,
      });
    } catch (logErr) {
      console.error('Failed to log transfer failure:', logErr);
    }
    console.error(`Socially transfer EXCEPTION (logged): ${errMsg}`);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    // When called by the webhook safety net, a user JWT is not available.
    // The webhook passes x-webhook-user-id (trusted — caller uses service role key).
    const webhookUserId = req.headers.get('x-webhook-user-id');
    let user: { id: string };

    if (webhookUserId) {
      // Internal call from paystack-webhook — bypass JWT check
      user = { id: webhookUserId };
      console.log('purchase-number: webhook-initiated call for user', webhookUserId);
    } else {
      const { data: { user: jwtUser }, error: userError } = await supabaseClient.auth.getUser(token);
      if (userError || !jwtUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        });
      }
      user = jwtUser;
    }

    const body = await req.json();
    const {
      provider_code,
      country_code,
      project_code,
      project_name,
      country_name,
      amount_paid,
      paystack_reference,  // present for card/bank payment path
      use_wallet,          // true = debit wallet_balance directly, skip Paystack
      webhook_verified,    // true = called from webhook (payment already confirmed there)
    } = body;

    if (!provider_code || !country_code || !project_code) {
      return new Response(JSON.stringify({ error: 'Missing required fields: provider_code, country_code, project_code' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
    if (!use_wallet && !paystack_reference) {
      return new Response(JSON.stringify({ error: 'Provide paystack_reference or set use_wallet: true' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // ── Idempotency guard: if a client-side call already completed this reference,
    //    return the existing order rather than purchasing again. ────────────────
    if (paystack_reference && !use_wallet) {
      const { data: existingOrder } = await supabaseAdmin
        .from('orders')
        .select('*')
        .eq('paystack_reference', paystack_reference)
        .maybeSingle();

      if (existingOrder) {
        console.log(`Idempotency: order ${existingOrder.id} already exists for Paystack ref ${paystack_reference} — returning existing`);
        return new Response(JSON.stringify({ data: { order: existingOrder, idempotent: true } }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    // ────────────────────────────────────────────────────────────────

    let paidAmount: number;

    if (use_wallet) {
      // ── WALLET PATH: atomic debit via RPC (prevents double-spend on concurrent taps) ──
      paidAmount = Number(amount_paid);
      if (!paidAmount || paidAmount <= 0) {
        return new Response(JSON.stringify({ error: 'Invalid amount_paid for wallet purchase' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        });
      }

      // debit_wallet() does UPDATE ... WHERE wallet_balance >= p_amount RETURNING wallet_balance
      // — raises INSUFFICIENT_BALANCE if balance is too low, preventing any race condition.
      const { data: newBalanceRow, error: debitRpcErr } = await supabaseAdmin
        .rpc('debit_wallet', { p_user_id: user.id, p_amount: paidAmount });

      if (debitRpcErr) {
        const isInsufficient = debitRpcErr.message?.includes('INSUFFICIENT_BALANCE');
        if (isInsufficient) {
          // Re-read actual balance to give a helpful message
          const { data: profileCheck } = await supabaseAdmin
            .from('user_profiles').select('wallet_balance').eq('id', user.id).single();
          const available = profileCheck?.wallet_balance ?? 0;
          return new Response(JSON.stringify({
            error: `Insufficient wallet balance. Available: ₦${Number(available).toLocaleString()}, required: ₦${paidAmount.toLocaleString()}.`,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 402,
          });
        }
        console.error('Wallet debit RPC error:', debitRpcErr);
        return new Response(JSON.stringify({ error: 'Failed to debit wallet. Please try again.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        });
      }

      const newBalance = Number(newBalanceRow);

      // Record the debit transaction now (before Socially call — rolled back below if needed)
      const walletRef = `wlt_${user.id.slice(0, 8)}_${Date.now()}`;
      await supabaseAdmin.from('transactions').insert({
        user_id: user.id,
        amount: paidAmount,
        type: 'debit',
        reference: walletRef,
        description: `${project_name || project_code} number - ${country_name || country_code} (wallet)`,
      });

      console.log(`Wallet debited: ₦${paidAmount} from user ${user.id}, new balance: ${newBalance}`);
      // ─────────────────────────────────────────────────────────────────────
    } else {
      // ── PAYSTACK PATH: verify payment ─────────────────────────────────────
      if (webhook_verified) {
        // Called from paystack-webhook which already verified the payment —
        // skip a redundant API round-trip and trust the amount from metadata.
        console.log(`Skipping Paystack verify for webhook-initiated call (ref: ${paystack_reference})`);
        paidAmount = Number(amount_paid);
        if (!paidAmount || paidAmount <= 0) {
          return new Response(JSON.stringify({ error: 'Invalid amount in webhook-initiated purchase' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
          });
        }
      } else {

      console.log('Verifying Paystack payment:', paystack_reference);
      const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
      const verifyRes = await fetch(`${PAYSTACK_BASE}/transaction/verify/${paystack_reference}`, {
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
      });

      const verifyData = await verifyRes.json();
      console.log('Paystack verify response:', JSON.stringify(verifyData));

      if (!verifyData.status || verifyData.data?.status !== 'success') {
        return new Response(JSON.stringify({ error: 'Payment not confirmed. Please try again.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 402,
        });
      }

      paidAmount = verifyData.data.amount / 100; // kobo to naira
      } // end: !webhook_verified verify block
      // ─────────────────────────────────────────────────────────────────────
    }

    // Generate a unique reference for Socially.ng
    const sociallyReference = `nv_${user.id.slice(0, 8)}_${Date.now()}`;

    // Route purchase through socially-proxy
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    console.log(`Purchasing number via socially-proxy: provider=${provider_code}, country=${country_code}, project=${project_code}, ref=${sociallyReference}`);

    const proxyRes = await fetch(`${supabaseUrl}/functions/v1/socially-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        path: '/buy/sms/verification/number',
        method: 'POST',
        body: {
          provider_code,
          country_code,
          project_code,
          reference: sociallyReference,
        },
      }),
    });

    const sociallyData = await proxyRes.json();
    console.log('Socially proxy response:', JSON.stringify(sociallyData));

    // Extract the most descriptive error from Socially response
    if (!proxyRes.ok || sociallyData.status === false) {
      const sociallyError =
        sociallyData.message ||
        sociallyData.error ||
        sociallyData.errors ||
        sociallyData.msg ||
        (typeof sociallyData === 'string' ? sociallyData : null) ||
        'Failed to purchase number from provider';

      // ── REFUND/ROLLBACK: Socially purchase failed after payment was taken ──
      // Wallet path: pure DB credit rollback. Paystack path: credit wallet so customer can retry.
      console.log(`Socially purchase failed. Refunding ₦${paidAmount} to user ${user.id} (wallet: ${use_wallet})`);
      try {
        const { data: profileNow } = await supabaseAdmin
          .from('user_profiles')
          .select('wallet_balance')
          .eq('id', user.id)
          .single();

        const newBalance = Number(profileNow?.wallet_balance || 0) + paidAmount;
        await supabaseAdmin
          .from('user_profiles')
          .update({ wallet_balance: newBalance })
          .eq('id', user.id);

        const refundRef = use_wallet
          ? `rollback_${user.id.slice(0, 8)}_${Date.now()}`
          : (paystack_reference || `refund_${Date.now()}`);

        await supabaseAdmin.from('transactions').insert({
          user_id: user.id,
          amount: paidAmount,
          type: 'credit',
          reference: refundRef,
          description: use_wallet
            ? `Wallet rollback: ${project_name || project_code} purchase failed — ${sociallyError}`
            : `Refund: ${project_name || project_code} purchase failed — ${sociallyError}`,
        });

        console.log(`Refund/rollback credited: ₦${paidAmount} → user ${user.id}, new balance: ${newBalance}`);
      } catch (refundErr) {
        console.error('CRITICAL: Refund/rollback step failed after Socially error:', refundErr);
      }
      // ──────────────────────────────────────────────────────────────────────

      return new Response(JSON.stringify({
        error: `Socially: ${sociallyError}`,
        refunded: true,
        refund_amount: paidAmount,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const numberData = sociallyData.data;
    // Per API docs: response has mobile_number, reference, service_name, amount_paid, status
    const phoneNumber = numberData?.mobile_number || numberData?.phone || numberData?.number || String(numberData);

    // Create order in database
    // order_reference = Socially internal ref (nv_...)
    // paystack_reference = Paystack payment ref (used for idempotency + webhook guard)
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: user.id,
        provider_code,
        country_id: String(country_code),
        country_name: country_name || String(country_code),
        project_id: String(project_code),
        project_name: project_name || project_code,
        phone_number: phoneNumber,
        amount_paid: paidAmount,
        status: 'pending',
        socially_order_id: sociallyReference,
        order_reference: sociallyReference,
        paystack_reference: paystack_reference || null,
        // country_id column stores the service string for Server B (e.g. "tiktok")
      })
      .select()
      .single();

    if (orderError) {
      console.error('Order insert error:', orderError);
      // ── REFUND/ROLLBACK: DB save failed after number was purchased ─────────
      try {
        const { data: profileNow2 } = await supabaseAdmin
          .from('user_profiles')
          .select('wallet_balance')
          .eq('id', user.id)
          .single();

        const newBalance = Number(profileNow2?.wallet_balance || 0) + paidAmount;
        await supabaseAdmin
          .from('user_profiles')
          .update({ wallet_balance: newBalance })
          .eq('id', user.id);

        await supabaseAdmin.from('transactions').insert({
          user_id: user.id,
          amount: paidAmount,
          type: 'credit',
          reference: paystack_reference || `rollback_${user.id.slice(0, 8)}_${Date.now()}`,
          description: use_wallet
            ? `Wallet rollback: order save failed for ${project_name || project_code}`
            : `Refund: order save failed for ${project_name || project_code}`,
        });

        console.log(`Refund/rollback credited (order save failure): ₦${paidAmount} → user ${user.id}`);
      } catch (refundErr) {
        console.error('CRITICAL: Refund/rollback step failed after order insert error:', refundErr);
      }
      // ──────────────────────────────────────────────────────────────────────
      return new Response(JSON.stringify({ error: 'Failed to save order', refunded: true, refund_amount: paidAmount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    // Record debit transaction for Paystack path only (wallet path recorded its debit above)
    if (!use_wallet) {
      await supabaseAdmin.from('transactions').insert({
        user_id: user.id,
        amount: paidAmount,
        type: 'debit',
        reference: paystack_reference,
        description: `${project_name || project_code} number - ${country_name || country_code}`,
      });
    }

    // ── RESPOND TO CLIENT IMMEDIATELY ────────────────────────────────────────
    // Fire the cost-recovery transfer AFTER the response is constructed so the
    // customer never waits on it. We use a non-blocking pattern: build the
    // response first, then kick off the transfer, then return.
    const successResponse = new Response(JSON.stringify({
      data: {
        order,
        number_data: numberData,
        socially_reference: sociallyReference,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    // Non-blocking transfer — intentionally not awaited before response.
    // Deno will keep this running even after the response is sent.
    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
    if (secretKey) {
      fireSociallyTransfer(supabaseAdmin, order.order_reference || sociallyReference, paidAmount, secretKey)
        .catch((e) => console.error('fireSociallyTransfer unhandled:', e));
    } else {
      console.warn('PAYSTACK_SECRET_KEY not set — skipping Socially transfer');
    }

    return successResponse;
  } catch (err) {
    console.error('Purchase number error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
