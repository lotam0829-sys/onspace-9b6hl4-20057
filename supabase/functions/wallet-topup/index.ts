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
        channels: ['card', 'bank_transfer', 'ussd', 'bank'],
        metadata: {
          user_id: user.id,
          type: type || 'number_purchase',
          ...(extraMeta || {}),
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
    console.error('Payment init error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
