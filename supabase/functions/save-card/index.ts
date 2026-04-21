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

    const { email } = await req.json();
    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY');

    // Initialize a ₦50 charge just to save the card (will be refunded)
    const reference = `numvault_card_${user.id.slice(0,8)}_${Date.now()}`;

    const initRes = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: 5000, // ₦50 in kobo - minimal charge to tokenize card
        reference,
        callback_url: 'https://numvault.app/payment/callback',
        metadata: {
          user_id: user.id,
          type: 'save_card',
        },
      }),
    });

    const initData = await initRes.json();

    if (!initData.status) {
      return new Response(JSON.stringify({ error: initData.message || 'Failed to initialize' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    return new Response(JSON.stringify({
      data: {
        authorization_url: initData.data.authorization_url,
        reference: initData.data.reference,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Save card error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
