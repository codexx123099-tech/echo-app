// SCHEDULED FUNCTION — runs once a day (see netlify.toml). Finds accounts
// that have gone 3+ days without an entry and haven't already gotten a
// re-engagement email in the last 7 days, and sends one via Resend.
//
// Required environment variables:
//   RESEND_API_KEY   — from resend.com (free tier is generous for this volume)
//   RESEND_FROM      — a sender address on a domain you've verified in Resend,
//                      e.g. 'Echo <hello@yourdomain.com>'
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Resend needs its own account + a verified sending domain — that setup
// can't be done from here, same as Stripe.

const { createClient } = require('@supabase/supabase-js');

const INACTIVE_AFTER_DAYS = 3;
const DONT_REPEAT_WITHIN_DAYS = 7;

exports.handler = async () => {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Re-engagement function is missing required environment variables.' };
  }

  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const inactiveCutoff = new Date(Date.now() - INACTIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const repeatCutoff = new Date(Date.now() - DONT_REPEAT_WITHIN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from('notification_prefs')
    .select('id, email, last_active_at, last_reengagement_email_at')
    .not('email', 'is', null)
    .lt('last_active_at', inactiveCutoff);

  if (error) {
    return { statusCode: 500, body: 'Could not read notification_prefs: ' + error.message };
  }

  const candidates = (rows || []).filter(
    (row) => !row.last_reengagement_email_at || row.last_reengagement_email_at < repeatCutoff
  );

  let sent = 0;
  const failures = [];

  for (const row of candidates) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM,
          to: row.email,
          subject: "It's been a few days",
          html:
            '<p>Hi,</p>' +
            "<p>It's been a few days since your last Echo entry. No pressure — even a quick 30-second note counts.</p>" +
            '<p><a href="' + (process.env.URL || '') + '">Open Echo</a></p>',
        }),
      });
      if (!res.ok) throw new Error('Resend API returned ' + res.status);

      await supabaseAdmin.from('notification_prefs').update({ last_reengagement_email_at: new Date().toISOString() }).eq('id', row.id);
      sent += 1;
    } catch (err) {
      failures.push({ id: row.id, error: err.message });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ candidates: candidates.length, sent, failures }) };
};
