// Cloudflare Pages Function — runs at the edge on every request to
// the site. When the downstream response is a 404, fires-and-forgets a
// single event to PostHog so we can data-drive 404-page improvements:
// which broken links matter, where users are coming from, and bot vs.
// human traffic.
//
// Why this lives at the edge instead of inside 404.html:
//   - Zero client bytes: no PostHog JS SDK to ship.
//   - Ad-blocker bypass: the request goes Cloudflare → PostHog
//     server-to-server, never client-to-third-party.
//   - Catches bots, RSS readers, link-checkers, JS-disabled clients —
//     exactly the populations most likely to hit broken backlinks.
//   - Captures EVERY 404, including ones where 404.html itself fails
//     to render.
//
// `phc_…` keys are PostHog's PUBLIC ingest keys — write-only, designed
// to ship in client code (already present verbatim in
// bunnypath_app/ios/Runner/Info.plist and AndroidManifest.xml). Safe
// to inline here; override via the POSTHOG_PUBLIC_KEY env var in the
// Cloudflare Pages project settings if you ever rotate.

const POSTHOG_KEY_DEFAULT = 'phc_vEovTPz4D8NcwWX6AkPFWNrdJKPLPZ9AMp5QM2SUYFRn';
const POSTHOG_HOST = 'https://us.i.posthog.com';

export const onRequest = async (ctx) => {
  // Let the static asset / route handler run first.
  const response = await ctx.next();
  if (response.status !== 404) return response;

  const url = new URL(ctx.request.url);
  const cf = ctx.request.cf || {};

  // Daily-rotating anon id — no cookies, no IP retention, GDPR-friendly.
  // Still aggregates unique-ish visitors WITHIN a day if you want it,
  // and PostHog's auto-deduplication keeps the event volume sane.
  const distinctId = `web404-${new Date().toISOString().slice(0, 10)}`;

  // waitUntil keeps the Worker alive for the POST without blocking the
  // response. .catch() swallows transport errors so telemetry can
  // never break a user-facing 404 page.
  ctx.waitUntil(
    fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: ctx.env.POSTHOG_PUBLIC_KEY || POSTHOG_KEY_DEFAULT,
        event: 'web.404',
        distinct_id: distinctId,
        properties: {
          path: url.pathname,
          query: url.search || null,
          referrer: ctx.request.headers.get('referer') || null,
          user_agent: ctx.request.headers.get('user-agent') || null,
          country: cf.country || null,
          colo: cf.colo || null,
          // Cloudflare bot-management verdict (0 = likely human,
          // 30 = unverified bot, 100 = verified bot). Filter post-hoc
          // in PostHog rather than at the edge — keep the raw signal.
          bot_score: cf.botManagement && cf.botManagement.score,
          // Useful slice for "users hitting old links from this build".
          // Stays null unless the referrer carried it (e.g. share links).
          referrer_host: (() => {
            const r = ctx.request.headers.get('referer');
            try { return r ? new URL(r).host : null; } catch { return null; }
          })(),
        },
      }),
    }).catch(() => {})
  );

  return response;
};
