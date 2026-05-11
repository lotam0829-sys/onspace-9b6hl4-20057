import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

/**
 * sms-webhook — receives OTP delivery callbacks from Socially.ng
 * Socially.ng POST body expected: { reference, otp, mobile_number, ... }
 */
Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const payload = await req.json();
    console.log('SMS webhook received:', JSON.stringify(payload));

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Socially.ng sends reference + OTP
    const reference = payload.reference || payload.order_reference || payload.ref;
    // OTP may be in message as "Your OTP (1234)..." or directly as otp field
    let otp = payload.otp || payload.code || payload.verification_code || null;
    if (!otp && payload.message) {
      const match = String(payload.message).match(/\((\d+)\)/);
      if (match) otp = match[1];
    }

    if (!reference || !otp) {
      console.log('Missing reference or OTP in webhook payload');
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`OTP received: ${otp} for reference: ${reference}`);

    // Find order by socially_order_id (the reference we generated)
    const { data: order, error: findError } = await supabaseAdmin
      .from('orders')
      .select('id, status')
      .eq('order_reference', reference)
      .single();

    if (findError || !order) {
      console.error('Order not found for reference:', reference, findError);
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update order with OTP and mark completed
    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ otp, status: 'completed' })
      .eq('id', order.id);

    if (updateError) {
      console.error('Failed to update order with OTP:', updateError);
    } else {
      console.log('Order updated with OTP:', order.id);
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
