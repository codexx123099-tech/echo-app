// SCHEDULED FUNCTION — runs every hour (see netlify.toml), checks which
// users' chosen reminder hour matches the current UTC hour, and sends
// each of them a push notification via Web Push — skipping anyone who's
// already journaled today, so this nudges rather than nags.
//
// Required environment variables:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — generate your own pair, or use
//     the ones already filled into NOTIFICATIONS_CONFIG in index.html
//     (the public key is safe to reuse; keep the private key here only)
//   VAPID_SUBJECT                        — 'mailto:you@yourdomain.com'
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Reminder function is missing required environment variables.' };
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:hello@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const currentUtcHour = new Date().getUTCHours();

  const { data: rows, error } = await supabaseAdmin
    .from('notification_prefs')
    .select('id, push_subscription, last_active_at')
    .eq('reminder_enabled', true)
    .eq('reminder_hour_utc', currentUtcHour)
    .not('push_subscription', 'is', null);

  if (error) {
    return { statusCode: 500, body: 'Could not read notification_prefs: ' + error.message };
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  let sent = 0;
  let cleared = 0;

  for (const row of rows || []) {
    const journaledToday = row.last_active_at && row.last_active_at.slice(0, 10) === todayStr;
    if (journaledToday) continue;

    try {
      await webpush.sendNotification(
        row.push_subscription,
        JSON.stringify({
          title: 'Echo',
          body: "Take a minute to check in with yourself today.",
          url: './',
        })
      );
      sent += 1;
    } catch (err) {
      // 404/410 means the browser subscription is dead (uninstalled,
      // permissions revoked, etc.) — clear it so we stop trying.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabaseAdmin.from('notification_prefs').update({ push_subscription: null, reminder_enabled: false }).eq('id', row.id);
        cleared += 1;
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ checked: (rows || []).length, sent, clearedDeadSubscriptions: cleared }) };
};
