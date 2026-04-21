import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const payload = await req.json();
    console.log('SMS Webhook received:', JSON.stringify(payload));

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Socially.ng webhook payload — extract OTP and reference
    const otp = payload.otp || payload.code || payload.sms_code;
    const reference = payload.reference || payload.order_id || payload.id || payload.phone;

    if (!otp || !reference) {
      console.log('Missing otp or reference in webhook payload');
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update the order with OTP
    const { data, error } = await supabaseAdmin
      .from('orders')
      .update({ otp: String(otp), status: 'completed' })
      .or(`socially_order_id.eq.${reference},phone_number.eq.${reference},order_reference.eq.${reference}`)
      .select();

    if (error) {
      console.error('Order update error:', error);
    } else {
      console.log('Order updated with OTP:', data);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('SMS webhook error:', err);
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
