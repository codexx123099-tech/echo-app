// Cancels a user's active Paystack subscription. Called from the client
// via POST (same endpoint path as before) with { userId }.
//
// Rather than storing the subscription_code/email_token from a webhook
// (fragile — depends on correctly parsing a second event's payload),
// this looks the active subscription up fresh from Paystack using the
// customer_code saved at checkout time. One extra API round-trip, but
// nothing to keep in sync.
//
// Note: Paystack's docs are genuinely ambiguous on whether the
// GET /subscription?customer=X filter expects the numeric customer id
// or the CUS_xxx code — rather than gamble on that, this fetches the
// list unfiltered and matches customer_code client-side, which works
// regardless of what that filter parameter actually expects.
//
// Required environment variables (same as the other Paystack functions):
//   PAYSTACK_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js');

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

  const { userId } = payload;
  if (!userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing user id.' }) };
  }

  if (!process.env.PAYSTACK_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Payments are not fully configured yet on the server.' }) };
  }

  try {
    const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: row, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('paystack_customer_code')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError || !row || !row.paystack_customer_code) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No active subscription found for this account.' }) };
    }

    const authHeaders = { 'Authorization': 'Bearer ' + process.env.PAYSTACK_SECRET_KEY };

    // Fetch the subscription list unfiltered (perPage=100 comfortably
    // covers current volume) and match the customer code ourselves,
    // rather than trust an ambiguous query-string filter to do it.
    const listRes = await fetch(PAYSTACK_BASE + '/subscription?perPage=100', { headers: authHeaders });
    const listData = await listRes.json();

    if (!listRes.ok || !listData.status) {
      return { statusCode: listRes.status || 500, body: JSON.stringify({ error: (listData && listData.message) || 'Could not read subscriptions from Paystack.' }) };
    }

    const subscription = (listData.data || []).find(
      (s) => s.customer && s.customer.customer_code === row.paystack_customer_code && s.status === 'active'
    );

    if (!subscription) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No active subscription found on Paystack.' }) };
    }

    // The list endpoint doesn't reliably include email_token — fetching
    // the subscription individually does, and disable requires it.
    const detailRes = await fetch(PAYSTACK_BASE + '/subscription/' + subscription.subscription_code, { headers: authHeaders });
    const detailData = await detailRes.json();
    const emailToken = detailData && detailData.data && detailData.data.email_token;

    if (!emailToken) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not retrieve subscription details from Paystack.' }) };
    }

    const disableRes = await fetch(PAYSTACK_BASE + '/subscription/disable', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: subscription.subscription_code, token: emailToken }),
    });
    const disableData = await disableRes.json();

    if (!disableRes.ok || !disableData.status) {
      return { statusCode: disableRes.status || 500, body: JSON.stringify({ error: (disableData && disableData.message) || 'Could not cancel the subscription.' }) };
    }

    // Plan flips to 'free' via the subscription.disable webhook once
    // Paystack actually processes the cancellation, not here directly —
    // same pattern as the Stripe version this replaced.
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Could not cancel the subscription.' }) };
  }
};
