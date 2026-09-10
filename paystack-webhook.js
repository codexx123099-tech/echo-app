// Handles Paystack webhook events and writes subscription status into
// Supabase's `profiles` table. Like the Stripe version this replaces,
// this is the ONLY place plan status gets written from a real payment —
// the client can only ever read it, which is what stops someone from
// just editing localStorage to grant themselves Plus for free.
//
// Setup in Paystack Dashboard > Settings > API Keys & Webhooks:
//   Webhook URL: https://<your-site>.netlify.app/.netlify/functions/paystack-webhook
//   (Paystack sends all event types to this one URL — no per-event
//   selection like Stripe has; this handler just ignores events it
//   doesn't care about.)
//
// Required environment variables:
//   PAYSTACK_SECRET_KEY         — same key used in create-checkout-session.js
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   — Supabase Project Settings > API > service_role key
//                                 (NOT the anon key — this one bypasses Row Level
//                                 Security, which is exactly why it must only ever
//                                 live here, server-side, never in client code)

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!process.env.PAYSTACK_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Required environment variables are not configured' };
  }

  // Paystack signs the raw request body with your secret key (HMAC-SHA512)
  // and sends it as the x-paystack-signature header — verifying this stops
  // anyone from forging a fake "payment succeeded" request straight at
  // this endpoint.
  const signature = event.headers['x-paystack-signature'];
  const expectedSignature = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(event.body || '')
    .digest('hex');

  if (!signature || signature !== expectedSignature) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let paystackEvent;
  try {
    paystackEvent = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    switch (paystackEvent.event) {
      case 'charge.success': {
        const charge = paystackEvent.data;
        // Only plan-based charges (i.e. subscription checkouts we
        // initialized with a `plan` code) should grant Plus — a random
        // one-off charge type Echo doesn't otherwise create shouldn't.
        const userId = charge.metadata && charge.metadata.supabase_user_id;
        if (userId && charge.plan) {
          await supabaseAdmin.from('profiles').upsert({
            id: userId,
            plan: 'plus',
            paystack_customer_code: charge.customer && charge.customer.customer_code,
            plan_started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }

      // Paystack's naming here varies by API version/account — handling
      // both observed event names defensively rather than guessing wrong
      // and silently missing cancellations.
      case 'subscription.disable':
      case 'subscription.not_renew':
      case 'invoice.payment_failed': {
        const obj = paystackEvent.data;
        const customerCode = obj.customer && obj.customer.customer_code;
        if (customerCode) {
          await supabaseAdmin
            .from('profiles')
            .update({ plan: 'free', updated_at: new Date().toISOString() })
            .eq('paystack_customer_code', customerCode);
        }
        break;
      }

      default:
        // Anything else (e.g. subscription.create, which we don't need
        // since charge.success already grants access) is ignored —
        // Paystack still expects a 200 response either way.
        break;
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    return { statusCode: 500, body: 'Webhook handler error: ' + err.message };
  }
};
