// Sends an email alert via Resend whenever someone submits a support
// request from Settings > Contact Support. The request itself is already
// saved to Supabase's support_requests table by the client directly (same
// pattern as notification_prefs) — this function's only job is the email
// nudge, so a failure here never loses the actual message, just the alert.
//
// Reuses the same Resend account already set up for re-engagement emails —
// no new account or API key needed, just this one function.
//
// Required environment variables (already set from the re-engagement email setup):
//   RESEND_API_KEY, RESEND_FROM
//
// Optional: SUPPORT_NOTIFY_EMAIL — where alerts are sent. Defaults to the
// address below if not set, so this works with zero extra Netlify config.

const NOTIFY_EMAIL_DEFAULT = 'akalumhejeff@gmail.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    // Not treated as a hard failure — the request is already safely saved
    // in Supabase regardless, this just means no email nudge goes out.
    return { statusCode: 200, body: JSON.stringify({ ok: true, emailed: false }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const email = (payload.email || '').trim();
  const message = (payload.message || '').trim();
  if (!email || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing email or message.' }) };
  }

  try {
    const notifyTo = process.env.SUPPORT_NOTIFY_EMAIL || NOTIFY_EMAIL_DEFAULT;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: notifyTo,
        reply_to: email, // so replying from your inbox goes straight back to the user
        subject: 'New Echo support request',
        html:
          '<p><strong>From:</strong> ' + escapeHtml(email) + '</p>' +
          '<p><strong>Message:</strong></p>' +
          '<p>' + escapeHtml(message).replace(/\n/g, '<br>') + '</p>',
      }),
    });

    // Even if Resend itself fails, the request is already saved in Supabase —
    // report ok so the client doesn't show a false error to the user over
    // what's just a missed email nudge.
    if (!response.ok) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, emailed: false }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, emailed: true }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, emailed: false }) };
  }
};

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
