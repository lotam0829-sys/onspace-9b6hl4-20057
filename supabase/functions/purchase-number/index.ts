import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const SOCIALLY_BASE = 'https://socially.ng/api/v1';

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

    const { provider_code, country_id, project_id, project_name, country_name, amount_paid } = await req.json();

    if (!provider_code || !country_id || !project_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Check wallet balance
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('wallet_balance')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'User profile not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }

    if (Number(profile.wallet_balance) < Number(amount_paid)) {
      return new Response(JSON.stringify({ error: 'Insufficient wallet balance' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 402,
      });
    }

    // Route purchase through socially-proxy (same as all other Socially.ng calls)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    console.log('Purchasing number via socially-proxy...');
    const proxyRes = await fetch(`${supabaseUrl}/functions/v1/socially-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        path: '/buy/sms/verification/number',
        method: 'POST',
        body: { provider_code, country_id },
      }),
    });

    const sociallyData = await proxyRes.json();
    console.log('Socially proxy response:', JSON.stringify(sociallyData));

    // Extract the most descriptive error from Socially's response
    const sociallyError =
      sociallyData.message ||
      sociallyData.error ||
      sociallyData.errors ||
      sociallyData.msg ||
      (typeof sociallyData === 'string' ? sociallyData : null) ||
      'Failed to purchase number';

    if (!proxyRes.ok || !sociallyData.data) {
      return new Response(JSON.stringify({ error: `Socially: ${sociallyError}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const numberData = sociallyData.data;
    const phoneNumber = numberData.phone || numberData.number || numberData.mobile || String(numberData);
    const orderId = numberData.id || numberData.order_id || numberData.reference;

    // Create order in database
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: user.id,
        provider_code,
        country_id,
        country_name,
        project_id,
        project_name,
        phone_number: phoneNumber,
        amount_paid,
        status: 'pending',
        socially_order_id: String(orderId),
        order_reference: String(orderId),
      })
      .select()
      .single();

    if (orderError) {
      console.error('Order insert error:', orderError);
      return new Response(JSON.stringify({ error: 'Failed to save order' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    // Deduct from wallet
    const { error: walletError } = await supabaseAdmin
      .from('user_profiles')
      .update({ wallet_balance: Number(profile.wallet_balance) - Number(amount_paid) })
      .eq('id', user.id);

    if (walletError) {
      console.error('Wallet deduction error:', walletError);
    }

    // Record transaction
    await supabaseAdmin.from('transactions').insert({
      user_id: user.id,
      amount: amount_paid,
      type: 'debit',
      reference: order.id,
      description: `${project_name} number - ${country_name}`,
    });

    return new Response(JSON.stringify({ data: { order, number_data: numberData } }), {
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
