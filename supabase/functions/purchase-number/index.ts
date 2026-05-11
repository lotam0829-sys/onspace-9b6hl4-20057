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
      paystack_reference,  // Paystack transaction reference to verify payment
    } = await req.json();

    if (!provider_code || !country_code || !project_code || !paystack_reference) {
      return new Response(JSON.stringify({ error: 'Missing required fields: provider_code, country_code, project_code, paystack_reference' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Verify Paystack payment
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

    const paidAmount = verifyData.data.amount / 100; // kobo to naira

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

      return new Response(JSON.stringify({ error: `Socially: ${sociallyError}` }), {
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
      return new Response(JSON.stringify({ error: 'Failed to save order' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    // Record transaction
    await supabaseAdmin.from('transactions').insert({
      user_id: user.id,
      amount: paidAmount,
      type: 'debit',
      reference: paystack_reference,
      description: `${project_name || project_code} number - ${country_name || country_code}`,
    });

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
