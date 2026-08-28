import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const PAYSTACK_BASE = 'https://api.paystack.co';

// ── Socially.ng funding account (Palmpay) ──────────────────────────────────
// Transfers are fired non-blocking after every successful purchase.
// Cost = revenue ÷ 1.4  (71.43% of amount paid, i.e. the pre-markup wholesale price).
// Recipient code is resolved once and cached in-memory for the function lifetime.
// Bank code is resolved dynamically from Paystack's /bank list (never hardcoded).
const SOCIALLY_ACCOUNT_NUMBER = '6635796668';
const SOCIALLY_ACCOUNT_NAME = 'Riteweb Digital Services-Sim(Paymentpoint)';
let cachedRecipientCode: string | null = null;

/**
 * Look up Palmpay's current bank_code from Paystack's /bank list.
 * Searches case-insensitively for any bank whose name contains "palmpay".
 * Throws if not found so the failure is logged rather than silently using a wrong code.
 */
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
  if (!match) {
    const names = data.data.map((b: { name: string; code: string }) => `${b.name} (${b.code})`).join(', ');
    throw new Error(`Palmpay not found in Paystack bank list. Available banks: ${names.slice(0, 500)}`);
  }
  console.log(`Resolved Palmpay bank_code: ${match.code} ("${match.name}")`);
  return match.code;
}

/**
 * Resolve or create a Paystack Transfer Recipient for the Socially.ng account.
 * Uses a simple in-memory cache so we only hit Paystack's API once per cold-start.
 */
async function getSociallyRecipientCode(secretKey: string): Promise<string> {
  if (cachedRecipientCode) return cachedRecipientCode;

  // Try to find an existing recipient matching our account number
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
      console.log(`Reusing existing transfer recipient: ${existing.recipient_code}`);
      cachedRecipientCode = existing.recipient_code;
      return cachedRecipientCode!;
    }
  }

  // Not found — resolve bank code dynamically then create recipient
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
  if (!createData.status || !createData.data?.recipient_code) {
    throw new Error(`Failed to create transfer recipient: ${JSON.stringify(createData)}`);
  }
  console.log(`Created new transfer recipient: ${createData.data.recipient_code} (bank_code: ${bankCode})`);
  cachedRecipientCode = createData.data.recipient_code;
  return cachedRecipientCode!;
}

/**
 * Fire a Paystack transfer of an explicit naira amount (not revenue-derived).
 * Used for shortfall transfers where part of the cost was already covered by pending credit.
 * Returns true on success, false on failure (never throws — failures are only logged).
 */
async function fireTransferDirect(
  supabaseAdmin: ReturnType<typeof createClient>,
  orderReference: string,
  amountNaira: number,
  secretKey: string,
  triggerReason: string,
): Promise<boolean> {
  const amountKobo = Math.round(amountNaira * 100);
  const transferRef = `st_${orderReference}_${Date.now()}`;
  let recipientCode: string | null = null;

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
        reason: `NumVault cost recovery [${triggerReason}] – order ${orderReference}`,
        reference: transferRef,
      }),
    });
    const transferData = await transferRes.json();
    console.log(`Transfer response [${triggerReason}]:`, JSON.stringify(transferData));

    if (transferData.status) {
      const ref2 = transferData.data?.transfer_code || transferData.data?.reference || transferRef;
      await supabaseAdmin.from('socially_transfers').insert({
        order_reference: orderReference,
        amount_transferred: amountNaira,
        paystack_transfer_reference: ref2,
        recipient_code: recipientCode,
        status: 'success',
        trigger_reason: triggerReason,
      });
      console.log(`Transfer SUCCESS [${triggerReason}]: ₦${amountNaira} → ${SOCIALLY_ACCOUNT_NUMBER} (ref: ${ref2})`);
      return true;
    } else {
      const errMsg = transferData.message || JSON.stringify(transferData);
      await supabaseAdmin.from('socially_transfers').insert({
        order_reference: orderReference,
        amount_transferred: amountNaira,
        paystack_transfer_reference: transferRef,
        recipient_code: recipientCode ?? 'unknown',
        status: 'failed',
        error_message: errMsg,
        trigger_reason: triggerReason,
      });
      console.error(`Transfer FAILED [${triggerReason}] (logged): ${errMsg}`);
      return false;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    try {
      await supabaseAdmin.from('socially_transfers').insert({
        order_reference: orderReference,
        amount_transferred: amountNaira,
        paystack_transfer_reference: transferRef,
        recipient_code: recipientCode ?? 'unknown',
        status: 'failed',
        error_message: errMsg,
        trigger_reason: triggerReason,
      });
    } catch (logErr) {
      console.error('Failed to log transfer failure:', logErr);
    }
    console.error(`Transfer EXCEPTION [${triggerReason}] (logged): ${errMsg}`);
    return false;
  }
}

/**
 * Fire a non-blocking Paystack transfer to the Socially.ng funding account.
 * Amount is derived from revenue: revenue ÷ 1.4 = wholesale cost.
 * NEVER throws — failures are only logged.
 *
 * When triggerReason is 'insufficient_balance_recovery' and userId is provided,
 * a successful transfer increments user_profiles.pending_socially_credit by the
 * transferred amount — tracking pre-sent credit that must be consumed before
 * the next wallet-funded sale fires its own replenishment.
 */
async function fireSociallyTransfer(
  supabaseAdmin: ReturnType<typeof createClient>,
  orderReference: string,
  revenueAmount: number,
  secretKey: string,
  triggerReason: string = 'post_sale_recovery',
  userId?: string,
): Promise<void> {
  // Cost = revenue ÷ 1.4 (removes 40% markup), rounded down to nearest kobo
  const costNaira = Math.floor((revenueAmount / 1.4) * 100) / 100;

  const success = await fireTransferDirect(
    supabaseAdmin,
    orderReference,
    costNaira,
    secretKey,
    triggerReason,
  );

  // If this was an insufficient-balance recovery and the transfer landed,
  // record the pre-sent credit on the user's profile so the next wallet-funded
  // purchase can consume it instead of triggering a duplicate transfer.
  if (success && triggerReason === 'insufficient_balance_recovery' && userId) {
    try {
      // Atomic increment — read current value then add (RPC would be cleaner but
      // concurrent insufficient-balance recoveries for the same user are extremely
      // unlikely, and the worst case is a slight over-credit that self-corrects).
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('pending_socially_credit')
        .eq('id', userId)
        .single();

      const current = Number(profile?.pending_socially_credit ?? 0);
      const updated = Math.round((current + costNaira) * 100) / 100;

      await supabaseAdmin
        .from('user_profiles')
        .update({ pending_socially_credit: updated })
        .eq('id', userId);

      console.log(`Pending Socially credit incremented: ₦${costNaira} → user ${userId} (new total: ₦${updated})`);
    } catch (creditErr) {
      console.error('Failed to increment pending_socially_credit after recovery transfer:', creditErr);
    }
  }
}

/**
 * Handle post-sale Socially.ng replenishment for a completed purchase.
 *
 * For fresh Paystack payments: always fire the full replenishment transfer (no pending
 * credit involved — wallet was not used, so there is no earlier recovery transfer to match).
 *
 * For wallet-funded purchases: check pending_socially_credit first.
 *   - If pending >= cost: consume all of cost from pending credit, skip transfer.
 *   - If 0 < pending < cost: consume all pending, fire a shortfall transfer for the remainder.
 *   - If pending == 0: fire the full transfer as usual.
 *
 * This prevents double-payment to Socially.ng when:
 *   1. A purchase fails with "insufficient balance" → recovery transfer fires + pending credit recorded.
 *   2. Customer spends the refunded wallet balance on a new (successful) purchase.
 *   Without this guard, step 2 would fire a second transfer for the same underlying wholesale cost.
 */
async function handlePostSaleReplenishment(
  supabaseAdmin: ReturnType<typeof createClient>,
  orderReference: string,
  revenueAmount: number,
  secretKey: string,
  userId: string,
  isWalletPurchase: boolean,
): Promise<void> {
  const costNaira = Math.floor((revenueAmount / 1.4) * 100) / 100;

  if (!isWalletPurchase) {
    // Fresh Paystack payment — no pending credit involved, fire full transfer
    await fireSociallyTransfer(supabaseAdmin, orderReference, revenueAmount, secretKey, 'post_sale_recovery');
    return;
  }

  // Wallet purchase — check for pre-sent credit first
  let pendingCredit = 0;
  try {
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('pending_socially_credit')
      .eq('id', userId)
      .single();
    pendingCredit = Math.max(0, Number(profile?.pending_socially_credit ?? 0));
  } catch (readErr) {
    console.error('Failed to read pending_socially_credit, falling back to full transfer:', readErr);
    // Safe fallback: fire full transfer (slight over-payment risk but correct behaviour)
    await fireSociallyTransfer(supabaseAdmin, orderReference, revenueAmount, secretKey, 'post_sale_recovery');
    return;
  }

  if (pendingCredit <= 0) {
    // No pre-sent credit: fire full transfer as usual
    await fireSociallyTransfer(supabaseAdmin, orderReference, revenueAmount, secretKey, 'post_sale_recovery');
    return;
  }

  // Round to avoid floating-point comparison noise
  const pendingRounded = Math.round(pendingCredit * 100) / 100;
  const costRounded = Math.round(costNaira * 100) / 100;

  if (pendingRounded >= costRounded) {
    // ── Full credit coverage: pending credit covers the entire wholesale cost ──
    // Consume exactly costNaira from pending credit and skip the transfer entirely.
    const newPending = Math.round((pendingRounded - costRounded) * 100) / 100;
    try {
      await supabaseAdmin
        .from('user_profiles')
        .update({ pending_socially_credit: newPending })
        .eq('id', userId);

      // Audit log: record the consumed credit as a zero-cash "transfer" entry
      await supabaseAdmin.from('socially_transfers').insert({
        order_reference: orderReference,
        amount_transferred: costRounded,
        paystack_transfer_reference: `credit_${orderReference}`,
        recipient_code: 'pending_credit_offset',
        status: 'success',
        trigger_reason: 'pending_credit_consumed',
      });

      console.log(
        `Pending credit fully consumed: ₦${costRounded} matched for order ${orderReference}. ` +
        `Remaining pending credit: ₦${newPending}. No transfer fired.`
      );
    } catch (consumeErr) {
      console.error('Failed to consume pending_socially_credit — firing full transfer as fallback:', consumeErr);
      await fireSociallyTransfer(supabaseAdmin, orderReference, revenueAmount, secretKey, 'post_sale_recovery');
    }
    return;
  }

  // ── Partial credit coverage: pending credit covers part of the cost ──
  // Consume all available pending credit, fire a transfer only for the shortfall.
  const shortfall = Math.round((costRounded - pendingRounded) * 100) / 100;
  try {
    await supabaseAdmin
      .from('user_profiles')
      .update({ pending_socially_credit: 0 })
      .eq('id', userId);

    // Audit log for the consumed portion
    await supabaseAdmin.from('socially_transfers').insert({
      order_reference: orderReference,
      amount_transferred: pendingRounded,
      paystack_transfer_reference: `credit_${orderReference}`,
      recipient_code: 'pending_credit_offset',
      status: 'success',
      trigger_reason: 'pending_credit_consumed',
    });

    console.log(
      `Pending credit partially consumed: ₦${pendingRounded} of ₦${costRounded} matched for order ${orderReference}. ` +
      `Firing shortfall transfer of ₦${shortfall}.`
    );
  } catch (consumeErr) {
    console.error('Failed to consume partial pending_socially_credit — firing full transfer as fallback:', consumeErr);
    await fireSociallyTransfer(supabaseAdmin, orderReference, revenueAmount, secretKey, 'post_sale_recovery');
    return;
  }

  // Fire transfer for only the shortfall amount (direct naira, not revenue-derived)
  await fireTransferDirect(
    supabaseAdmin,
    `${orderReference}_shortfall`,
    shortfall,
    secretKey,
    'post_sale_recovery_shortfall',
  ).catch((e) => console.error('fireTransferDirect (shortfall) unhandled:', e));
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
      paystack_reference,
      use_wallet,
      webhook_verified,
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

    // ── Idempotency guard ────────────────────────────────────────────────────
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
    // ────────────────────────────────────────────────────────────────────────

    let paidAmount: number;

    if (use_wallet) {
      // ── WALLET PATH ──────────────────────────────────────────────────────────
      paidAmount = Number(amount_paid);
      if (!paidAmount || paidAmount <= 0) {
        return new Response(JSON.stringify({ error: 'Invalid amount_paid for wallet purchase' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        });
      }

      const { data: newBalanceRow, error: debitRpcErr } = await supabaseAdmin
        .rpc('debit_wallet', { p_user_id: user.id, p_amount: paidAmount });

      if (debitRpcErr) {
        const isInsufficient = debitRpcErr.message?.includes('INSUFFICIENT_BALANCE');
        if (isInsufficient) {
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
      const walletRef = `wlt_${user.id.slice(0, 8)}_${Date.now()}`;
      await supabaseAdmin.from('transactions').insert({
        user_id: user.id,
        amount: paidAmount,
        type: 'debit',
        reference: walletRef,
        description: `${project_name || project_code} number - ${country_name || country_code} (wallet)`,
      });
      console.log(`Wallet debited: ₦${paidAmount} from user ${user.id}, new balance: ${newBalance}`);
      // ────────────────────────────────────────────────────────────────────────
    } else {
      // ── PAYSTACK PATH ────────────────────────────────────────────────────────
      if (webhook_verified) {
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

        paidAmount = verifyData.data.amount / 100;
      }
      // ────────────────────────────────────────────────────────────────────────
    }

    // Generate a unique reference for Socially.ng
    const sociallyReference = `nv_${user.id.slice(0, 8)}_${Date.now()}`;

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

    if (!proxyRes.ok || sociallyData.status === false) {
      const sociallyError =
        sociallyData.message ||
        sociallyData.error ||
        sociallyData.errors ||
        sociallyData.msg ||
        (typeof sociallyData === 'string' ? sociallyData : null) ||
        'Failed to purchase number from provider';

      // ── Detect insufficient-balance failure specifically ──────────────────
      // Socially.ng returns messages like "Insufficient balance" when their
      // reserve is depleted. We distinguish this from other error types (route
      // not found, auth, service unavailable, etc.) to trigger proactive recovery.
      const sociallyErrLower = String(sociallyError).toLowerCase();
      const isInsufficientBalance =
        sociallyErrLower.includes('insufficient') ||
        (sociallyErrLower.includes('balance') && !sociallyErrLower.includes('wallet'));

      // ── REFUND/ROLLBACK ──────────────────────────────────────────────────────
      console.log(`Socially purchase failed (isInsufficientBalance=${isInsufficientBalance}). Refunding ₦${paidAmount} to user ${user.id}`);
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
      // ────────────────────────────────────────────────────────────────────────

      // ── Insufficient-balance recovery transfer ───────────────────────────────
      // Send 71.43% of this failed transaction's cash directly to Socially.ng's
      // reserve — non-blocking. When this succeeds, fireSociallyTransfer also
      // increments user_profiles.pending_socially_credit so the NEXT wallet-funded
      // purchase from this user can consume the pre-sent credit instead of firing
      // a duplicate transfer (see handlePostSaleReplenishment).
      const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
      if (isInsufficientBalance && secretKey) {
        const recoveryRef = paystack_reference
          ? `insbal_${paystack_reference}`
          : `insbal_${user.id.slice(0, 8)}_${Date.now()}`;
        console.log(`Insufficient-balance recovery: firing ₦${Math.floor((paidAmount / 1.4) * 100) / 100} transfer (ref: ${recoveryRef})`);
        fireSociallyTransfer(
          supabaseAdmin,
          recoveryRef,
          paidAmount,
          secretKey,
          'insufficient_balance_recovery',
          user.id,          // ← pass userId so pending_socially_credit is incremented on success
        ).catch((e) => console.error('fireSociallyTransfer (insufficient_balance_recovery) unhandled:', e));
      }
      // ────────────────────────────────────────────────────────────────────────

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
    const phoneNumber = numberData?.mobile_number || numberData?.phone || numberData?.number || String(numberData);

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
      })
      .select()
      .single();

    if (orderError) {
      console.error('Order insert error:', orderError);
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
      return new Response(JSON.stringify({ error: 'Failed to save order', refunded: true, refund_amount: paidAmount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    if (!use_wallet) {
      await supabaseAdmin.from('transactions').insert({
        user_id: user.id,
        amount: paidAmount,
        type: 'debit',
        reference: paystack_reference,
        description: `${project_name || project_code} number - ${country_name || country_code}`,
      });
    }

    // ── Respond to client immediately ────────────────────────────────────────
    const successResponse = new Response(JSON.stringify({
      data: {
        order,
        number_data: numberData,
        socially_reference: sociallyReference,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    // ── Non-blocking post-sale replenishment ─────────────────────────────────
    // For wallet purchases: checks pending_socially_credit first and consumes it
    // before firing a new transfer (prevents duplicate payment when a prior
    // insufficient-balance recovery already sent the funds for this cost).
    // For fresh Paystack purchases: always fires the full transfer as usual.
    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
    if (secretKey) {
      handlePostSaleReplenishment(
        supabaseAdmin,
        order.order_reference || sociallyReference,
        paidAmount,
        secretKey,
        user.id,
        !!use_wallet,
      ).catch((e) => console.error('handlePostSaleReplenishment unhandled:', e));
    } else {
      console.warn('PAYSTACK_SECRET_KEY not set — skipping Socially replenishment');
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
