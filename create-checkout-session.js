// Starts an Echo Plus subscription via Paystack. Called from the client
// via POST /.netlify/functions/create-checkout-session (same path as
// before — only what happens inside changed) with
// { cycle: 'monthly'|'yearly', userId, userEmail }.
//
// Required environment variables (Paystack Dashboard > Settings > API Keys & Webhooks):
//   PAYSTACK_SECRET_KEY
//   PAYSTACK_PLAN_MONTHLY  — Plan code from Paystack Dashboard > Payments > Plans
//   PAYSTACK_PLAN_YEARLY
//
// Note: the plan's amount is configured in Paystack's dashboard when you
// create the plan (in kobo, i.e. Naira x 100) — this function never
// handles the amount directly, only which plan to subscribe to. Make sure
// PLUS_PRICING in index.html actually matches what these plans charge —
// nothing here enforces that automatically.

const PAYSTACK_BASE = 'https://api.paystack.co';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { cycle, userId, userEmail } = payload;
  if (!userId || !userEmail) {
    return { statusCode: 400, body: JSON.stringify({ error: 'You need to be signed in to subscribe.' }) };
  }

  const planCode = cycle === 'yearly' ? process.env.PAYSTACK_PLAN_YEARLY : process.env.PAYSTACK_PLAN_MONTHLY;
  if (!process.env.PAYSTACK_SECRET_KEY || !planCode) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Payments are not fully configured yet on the server.' }) };
  }

  try {
    const origin = event.headers.origin || process.env.URL || '';

    // Initializing with a `plan` (rather than a raw `amount`) tells
    // Paystack to charge that plan's price AND automatically create the
    // recurring subscription once this first payment succeeds — no
    // separate "create subscription" call needed on our end.
    const res = await fetch(PAYSTACK_BASE + '/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.PAYSTACK_SECRET_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: userEmail,
        plan: planCode,
        callback_url: origin + '/?checkout=success',
        metadata: { supabase_user_id: userId, cycle },
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.status) {
      return { statusCode: res.status || 500, body: JSON.stringify({ error: (data && data.message) || 'Could not start checkout.' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ url: data.data.authorization_url }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Could not start checkout.' }) };
  }
};
