import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const PAYSTACK_BASE = 'https://api.paystack.co';

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

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const {
      provider_code,
      country_code,
      project_code,
      project_name,
      country_name,
      amount_paid,
      paystack_reference,  // present for card/bank payment path
      use_wallet,          // true = debit wallet_balance directly, skip Paystack
    } = await req.json();

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
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: user.id,
        provider_code,
        country_id: country_code,  // store as country_id column for backward compat
        country_name: country_name || String(country_code),
        project_id: 0,             // project_id column kept for backward compat
        project_name: project_name || project_code,
        phone_number: phoneNumber,
        amount_paid: paidAmount,
        status: 'pending',
        socially_order_id: sociallyReference,
        order_reference: sociallyReference,
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

    return new Response(JSON.stringify({
      data: {
        order,
        number_data: numberData,
        socially_reference: sociallyReference,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Purchase number error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
