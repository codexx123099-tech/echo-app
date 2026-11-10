// Returns current naira-per-dollar and naira-per-pound rates, used ONLY to
// show visitors outside Nigeria an approximate price hint on the paywall.
// Charging is always in naira (Paystack for Nigerian businesses supports only
// NGN and USD, no GBP) — the customer's bank converts at its own rate, so
// these numbers are hints, never prices.
//
// Why a server function instead of the browser calling the rates service:
// the user's browser never contacts a third party for this, which matches
// Echo's privacy-first pitch, and rates get cached in one place.
//
// Source: fawazahmed0's free exchange-api (no key, no rate limit). It
// publishes new rates once a day, so "live" here means "refreshed daily at
// the source, re-fetched here at most hourly". A mirror is tried if the
// primary CDN fails, as that project recommends.
//
// No environment variables needed.

const SOURCES = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
];
const CACHE_MS = 60 * 60 * 1000; // re-fetch from the source at most hourly
const TIMEOUT_MS = 4000;

// Sanity band for naira per 1 unit of foreign currency. The naira has moved
// from ~460 to ~1,600 per dollar in recent years; this band is wide enough
// to survive that kind of swing but rejects obviously broken data (for
// example an inverted rate like 0.0007).
const MIN_NGN = 200;
const MAX_NGN = 20000;

let cache = null; // { at, body }

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseRates(data) {
  const usd = data && data.usd;
  if (!usd) return null;
  const ngnPerUsd = Number(usd.ngn);
  const gbpPerUsd = Number(usd.gbp);
  if (!(ngnPerUsd > 0) || !(gbpPerUsd > 0)) return null;
  const ngnPerGbp = ngnPerUsd / gbpPerUsd;
  const ok = (n) => Number.isFinite(n) && n >= MIN_NGN && n <= MAX_NGN;
  if (!ok(ngnPerUsd) || !ok(ngnPerGbp)) return null;
  return {
    usdNgn: Math.round(ngnPerUsd * 100) / 100,
    gbpNgn: Math.round(ngnPerGbp * 100) / 100,
    asOf: typeof data.date === 'string' ? data.date : null,
  };
}

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
  };

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return { statusCode: 200, headers, body: cache.body };
  }

  for (const url of SOURCES) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const rates = parseRates(await res.json());
      if (!rates) continue;
      const body = JSON.stringify(rates);
      cache = { at: Date.now(), body };
      return { statusCode: 200, headers, body };
    } catch (e) {
      // try the next source
    }
  }

  // No usable fresh data. Serve the last good value if we have one (still
  // better than nothing, and flagged by its asOf date); otherwise fail so
  // the app simply hides the hint rather than show a wrong number.
  if (cache) return { statusCode: 200, headers: { ...headers, 'Cache-Control': 'no-store' }, body: cache.body };
  return { statusCode: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: 'Rates unavailable' }) };
};

exports._parseRates = parseRates; // exported only so it can be unit-tested
