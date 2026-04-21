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

    const { amount, email, type, auth_code } = await req.json();
    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY');

    // If we have a stored auth code, charge directly
    if (auth_code) {
      console.log('Charging card with authorization code...');
      const chargeRes = await fetch(`${PAYSTACK_BASE}/transaction/charge_authorization`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authorization_code: auth_code,
          email,
          amount: Math.round(amount * 100), // kobo
          metadata: {
            user_id: user.id,
            type: type || 'wallet_topup',
          },
        }),
      });

      const chargeData = await chargeRes.json();
      console.log('Charge response:', JSON.stringify(chargeData));

      if (chargeData.status && chargeData.data?.status === 'success') {
        // Credit wallet immediately
        const supabaseAdmin = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { data: profile } = await supabaseAdmin
          .from('user_profiles')
          .select('wallet_balance')
          .eq('id', user.id)
          .single();

        const newBalance = Number(profile?.wallet_balance || 0) + amount;
        await supabaseAdmin.from('user_profiles')
          .update({ wallet_balance: newBalance })
          .eq('id', user.id);

        await supabaseAdmin.from('transactions').insert({
          user_id: user.id,
          amount,
          type: 'credit',
          reference: chargeData.data.reference,
          description: 'Wallet top-up via saved card',
        });

        return new Response(JSON.stringify({ data: { success: true, new_balance: newBalance } }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({ error: chargeData.message || 'Charge failed' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        });
      }
    }

    // Initialize new transaction (for WebView flow)
    const reference = `numvault_${user.id.slice(0,8)}_${Date.now()}`;
    console.log('Initializing Paystack transaction:', reference);

    const initRes = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100), // kobo
        reference,
        callback_url: 'https://numvault.app/payment/callback',
        metadata: {
          user_id: user.id,
          type: type || 'wallet_topup',
        },
      }),
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
    console.error('Wallet topup error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
