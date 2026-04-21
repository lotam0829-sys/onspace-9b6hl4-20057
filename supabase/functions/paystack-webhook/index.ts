import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const PAYSTACK_BASE = 'https://api.paystack.co';

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const payload = await req.json();
    console.log('Paystack webhook event:', payload.event);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY');

    if (payload.event === 'charge.success') {
      const { reference, customer, metadata, authorization } = payload.data;
      const userId = metadata?.user_id;
      const type = metadata?.type; // 'wallet_topup' or 'save_card'
      const amount = payload.data.amount / 100; // Paystack amounts in kobo

      console.log(`Payment success: ${reference}, type: ${type}, user: ${userId}, amount: ${amount}`);

      if (!userId) {
        console.log('No user_id in metadata, skipping');
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Save card authorization if available
      if (authorization?.authorization_code && authorization.reusable) {
        await supabaseAdmin.from('user_profiles').update({
          paystack_customer_code: customer?.customer_code || null,
          card_last4: authorization.last4,
          card_auth_code: authorization.authorization_code,
          card_brand: authorization.card_type,
          card_exp_month: authorization.exp_month,
          card_exp_year: authorization.exp_year,
        }).eq('id', userId);
        console.log('Card saved for user:', userId);
      }

      // Credit wallet for top-up payments
      if (type === 'wallet_topup' || type === 'save_card') {
        if (type === 'wallet_topup') {
          // Get current balance
          const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('wallet_balance')
            .eq('id', userId)
            .single();

          const newBalance = Number(profile?.wallet_balance || 0) + amount;
          await supabaseAdmin.from('user_profiles')
            .update({ wallet_balance: newBalance })
            .eq('id', userId);

          // Record transaction
          await supabaseAdmin.from('transactions').insert({
            user_id: userId,
            amount,
            type: 'credit',
            reference,
            description: 'Wallet top-up via Paystack',
          });

          console.log(`Wallet credited: ${amount} for user ${userId}`);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Paystack webhook error:', err);
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
