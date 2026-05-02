/**
 * Bunny Path — App Store review monitor.
 *
 * Cross-reference: production-readiness plan §B16 / §6 Q7
 * (build vs. Appfigures). This is the lightweight in-house alternative —
 * a Cloudflare Worker that polls Apple's RSS reviews feed once an hour,
 * dedupes against KV, and either logs new reviews or fans them out to a
 * webhook (Slack / Discord / generic POST).
 *
 * Why RSS and not the App Store Connect API: RSS is unauthenticated, has
 * no rate limit headache, and is the same feed Appfigures / Sensor Tower
 * scrape. Tradeoff: lags the live store by ~10–60 minutes and only
 * surfaces public reviews. That's fine — we just want a "hey, new 1-star"
 * nudge, not a forensic store-ops dashboard.
 *
 * Schedule: hourly cron. Apple's RSS updates roughly every 10–30 minutes;
 * 1h is a sane low-noise default. Reduce to a 15-minute cron expression
 * if you want faster pings, but that also multiplies the chance you'll
 * burn through your KV write quota on busy weeks.
 *
 * Bindings (declared in wrangler-app-review-monitor.toml):
 *   - KV namespace: REVIEW_STATE
 *   - Secret (optional): REVIEW_WEBHOOK_URL
 */

const APP_STORE_ID = '6761960397';
const FEED_URL =
  `https://itunes.apple.com/us/rss/customerreviews/id=${APP_STORE_ID}/sortBy=mostRecent/json`;

// KV key for the deduped review-id set. Stored as a JSON array of ids
// (strings). Capped at the most recent N to keep the value small —
// Apple's RSS feed returns at most ~50 entries anyway, so 200 is plenty
// of headroom against re-firing for an old review that briefly drops out
// and reappears.
const SEEN_KEY = 'seen-review-ids';
const SEEN_CAP = 200;

export default {
  // Cron-trigger entry point. `scheduled` runs on the schedule declared
  // in `wrangler-app-review-monitor.toml [triggers] crons`.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pollReviews(env));
  },

  // HTTP entry point — handy for manual triggering during setup
  // (`curl https://<worker-url>/run`) without having to wait for the
  // next cron tick. Anything else returns a 404.
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const result = await pollReviews(env);
      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  },
};

async function pollReviews(env) {
  const t0 = Date.now();
  let feedRes;
  try {
    feedRes = await fetch(FEED_URL, {
      headers: { accept: 'application/json' },
      cf: { cacheTtl: 60 },
    });
  } catch (err) {
    console.error('[reviews] feed fetch threw:', err && err.message);
    return { ok: false, reason: 'fetch-threw', error: String(err) };
  }
  if (!feedRes.ok) {
    console.error('[reviews] feed non-ok:', feedRes.status);
    return { ok: false, reason: 'feed-non-ok', status: feedRes.status };
  }

  let payload;
  try {
    payload = await feedRes.json();
  } catch (err) {
    console.error('[reviews] feed parse failed:', err && err.message);
    return { ok: false, reason: 'parse-failed' };
  }

  const entries = Array.isArray(payload && payload.feed && payload.feed.entry)
    ? payload.feed.entry
    : [];

  // Apple's RSS puts the app-metadata row first, with `im:name` populated
  // and no `id`. Filter it out so we only iterate real review entries.
  const reviews = entries
    .filter((e) => e && e.id && e.id.label)
    .map((e) => ({
      id: String(e.id.label),
      title: pluck(e, 'title'),
      content: pluck(e, 'content'),
      rating: Number(pluck(e, 'im:rating')) || null,
      version: pluck(e, 'im:version'),
      author: e.author && pluck(e.author, 'name'),
      updated: pluck(e, 'updated'),
    }));

  const seen = await loadSeen(env);
  const newReviews = reviews.filter((r) => !seen.has(r.id));

  console.log(
    '[reviews] feed has', reviews.length, 'entries,',
    newReviews.length, 'new (in', Date.now() - t0, 'ms)',
  );

  if (newReviews.length === 0) {
    return { ok: true, total: reviews.length, new: 0 };
  }

  // Optional webhook fan-out. Sequential rather than parallel so a slow
  // webhook can't blow the Worker's wall-clock budget for the cron run.
  const webhookUrl = env.REVIEW_WEBHOOK_URL;
  if (webhookUrl) {
    for (const r of newReviews) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            source: 'bunnypath-app-review-monitor',
            app_store_id: APP_STORE_ID,
            review: r,
          }),
        });
      } catch (err) {
        console.error('[reviews] webhook err for', r.id, err && err.message);
      }
    }
  }

  // Add new ids and persist the trimmed window. Ordering: keep the most
  // recently-seen ids at the head so the cap evicts genuinely old ones.
  const merged = [...newReviews.map((r) => r.id), ...seen];
  const trimmed = dedupeOrdered(merged).slice(0, SEEN_CAP);
  await env.REVIEW_STATE.put(SEEN_KEY, JSON.stringify(trimmed));

  // Log each new review so they show up in `wrangler tail`.
  for (const r of newReviews) {
    console.log(
      '[reviews] NEW',
      r.rating ? `${r.rating}*` : '?',
      `"${(r.title || '').slice(0, 80)}"`,
      'by', r.author || 'anon',
      '— v' + (r.version || '?'),
    );
  }

  return { ok: true, total: reviews.length, new: newReviews.length };
}

async function loadSeen(env) {
  try {
    const raw = await env.REVIEW_STATE.get(SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (err) {
    console.error('[reviews] loadSeen err:', err && err.message);
    return new Set();
  }
}

// Apple's RSS uses {label: "..."} wrappers on most fields. This pulls
// the string out, returning '' when missing.
function pluck(obj, key) {
  const v = obj && obj[key];
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v.label === 'string') return v.label;
  return '';
}

function dedupeOrdered(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}
