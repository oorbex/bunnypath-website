/**
 * Bunny Path. Per-activity Open Graph + rich landing-page Worker.
 *
 * Route: bunnypath.com/* (dispatch-by-shape)
 *
 * Why this exists: GitHub Pages only serves static HTML, and crawlers
 * (iMessage / WhatsApp / Slack / Twitter / Facebook) don't run JS. So a
 * client-side fetch in 404.html can't populate <meta property="og:*">.
 * This Worker also pre-renders the rich activity-share landing card
 * server-side (sender attribution, full description, materials, partial
 * steps with the rest blurred, benefits, related activities, social
 * proof, smart-app-banner, floating CTA, cohort prompt, sms/mailto
 * fallbacks) so search engines / unfurlers see the full page and the
 * user gets no hydration flash.
 *
 * Everything outside the activity / referral path shapes is passed
 * straight through to the GitHub Pages origin, index, legal pages,
 * AASA, assets, etc. all keep working unchanged.
 */

const SUPABASE_URL = 'https://ffffbbmzuwcpwuhodpvb.supabase.co';
const SITE_ORIGIN = 'https://bunnypath.com';
const APP_STORE_ID = '6761960397';
const ANDROID_BUNDLE = 'com.kodsters.bunnypath';
// 512×512 ~256 KB, the full Bunny Path wordmark (same artwork as the
// homepage nav and `assets/logo.png`), downscaled and saved separately
// as `og-image.png` so social-preview clients fetch a small file fast.
const OG_IMAGE = 'https://bunnypath.com/assets/og-image.png';
const ACTIVITY_PATH_RE = /^\/a\/([A-Za-z0-9-]+)\/?$/;
// 6-char base32-style referral codes, same alphabet the Flutter app uses
// (excludes 0/O, 1/l/I, U for human-readability). Lives at the root path.
const REFERRAL_PATH_RE = /^\/([abcdefghjkmnpqrstvwxyz23456789]{6})\/?$/i;

// Apple App-Site-Association: must be served as application/json with no
// extension on the URL. GitHub Pages serves it as text/plain by default,
// which silently breaks iOS Universal Links. Since this Worker is on the
// catch-all `bunnypath.com/*` route, we intercept the request, fetch the
// static file from origin, and rewrite the Content-Type. Same treatment
// for the Android assetlinks.json (Digital Asset Links. Also requires
// application/json per Google's docs).
const AASA_PATH = '/.well-known/apple-app-site-association';
const ASSETLINKS_PATH = '/.well-known/assetlinks.json';

// ---------------------------------------------------------------------------
// Edge analytics (PostHog, server-to-server)
// ---------------------------------------------------------------------------
// This Worker is the ONLY code that runs on every request (the topology is
// Worker -> GitHub Pages origin, so Cloudflare Pages Functions never
// execute), which makes it the one honest place to measure the marketing
// site: zero client bytes, ad-blocker-proof, and it sees bots, RSS readers
// and JS-disabled clients too. Captures `web.pageview` for HTML page loads
// and `web.404` for not-found responses, with UTM params + referrer so
// channel attribution survives to PostHog.
//
// `phc_…` keys are PostHog's PUBLIC ingest keys — write-only, designed to
// ship in client code (already present verbatim in the app's Info.plist /
// AndroidManifest.xml). Override via the POSTHOG_PUBLIC_KEY Worker env var
// if you ever rotate.
const POSTHOG_KEY_DEFAULT = 'phc_vEovTPz4D8NcwWX6AkPFWNrdJKPLPZ9AMp5QM2SUYFRn';
const POSTHOG_HOST = 'https://us.i.posthog.com';
const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
];

/// Fire-and-forget pageview/404 capture. Never throws, never blocks the
/// response — telemetry must not be able to break a user-facing page.
function capturePageview(request, url, response, env, ctx) {
  try {
    if (request.method !== 'GET') return;
    const is404 = response.status === 404;
    const contentType = response.headers.get('content-type') || '';
    // Only page navigations are interesting: HTML responses, plus every
    // 404 regardless of type (broken backlinks matter even for assets).
    if (!is404 && !contentType.includes('text/html')) return;

    const cf = request.cf || {};
    const properties = {
      path: url.pathname,
      query: url.search || null,
      referrer: request.headers.get('referer') || null,
      user_agent: request.headers.get('user-agent') || null,
      country: cf.country || null,
      colo: cf.colo || null,
      // Cloudflare bot-management verdict — keep the raw signal and
      // filter post-hoc in PostHog rather than at the edge.
      bot_score: cf.botManagement && cf.botManagement.score,
      status: response.status,
      // Whether this response was SSR'd by the worker (activity/referral
      // card) or passed through from the origin.
      served: response.headers.get('x-bunnypath-og') ? 'og-worker' : 'origin',
    };
    for (const key of UTM_KEYS) {
      const value = url.searchParams.get(key);
      if (value) properties[key] = value.slice(0, 120);
    }

    // Daily-rotating anon id — no cookies, no IP retention.
    const distinctId = `web-${new Date().toISOString().slice(0, 10)}`;

    ctx.waitUntil(
      fetch(`${POSTHOG_HOST}/capture/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: (env && env.POSTHOG_PUBLIC_KEY) || POSTHOG_KEY_DEFAULT,
          event: is404 ? 'web.404' : 'web.pageview',
          distinct_id: distinctId,
          properties,
        }),
      }).catch(() => {}),
    );
  } catch (_) {
    // Swallow everything: analytics can never break serving.
  }
}

// Security headers applied to every successful Worker response. Factored
// out so the AASA / referral / activity / fallback paths can't drift.
//
// CSP notes:
// - `default-src 'self'` is the baseline.
// - `img-src 'self' data: https:` lets the worker-rendered cards show
//   any HTTPS image (Apple/Google store badges, Supabase-hosted activity
//   art, etc.) without per-domain allowlisting.
// - `style-src 'self' 'unsafe-inline'` is required because the worker
//   inlines critical CSS in <head> for first-paint perf, and the
//   marketing site has inline <style> blocks too.
// - `script-src 'self' 'unsafe-inline' https://unpkg.com` covers the
//   marketing site's inline init scripts and the lucide icon CDN bundle
//   (`<script src="https://unpkg.com/lucide@..."`). Tightening to
//   `'self'` would break the homepage; revisit once we self-host lucide
//   and move inline scripts to external files.
// - `frame-ancestors 'none'` blocks clickjacking; the marketing site
//   never embeds itself.
const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: https:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline' https://unpkg.com; " +
    "font-src 'self' data: https:; " +
    "connect-src 'self' https:; " +
    "frame-ancestors 'none'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

// Apply the security header bundle to a Headers object in place. Only
// sets keys not already present so callers can override per-route (e.g.
// AASA wants a stricter cache-control).
function applySecurityHeaders(headers) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
}

// Wrap a Response, layering on the security headers without mutating the
// original (Response headers are read-only in some runtimes). Used by the
// passthrough path so GitHub Pages assets also get HSTS/CSP/etc.
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Serve the AASA / assetlinks files with `Content-Type: application/json`.
// We pull the bytes from the GitHub Pages origin (so the file stays a
// single source of truth in the repo), then rebuild the response with a
// corrected content-type and a sensible cache-control. Apple recommends
// 1-hour cache for AASA so updates propagate within a reasonable window.
async function handleWellKnownJson(request) {
  // Always fetch from the APEX origin, whatever host the request came in
  // on. GitHub Pages 301-redirects www -> apex, and both Android's Digital
  // Asset Links verifier and Apple's AASA fetcher refuse redirects on
  // /.well-known/* — a www request passed through verbatim would surface
  // that 301 and silently break App/Universal Link verification for the
  // www host (half of the Play Console "deep links failing" alert).
  const path = new URL(request.url).pathname;
  const upstream = await fetch(`${SITE_ORIGIN}${path}`);
  if (!upstream.ok) {
    // Pass the upstream error through; nothing we can do without the file.
    return withSecurityHeaders(upstream);
  }
  const body = await upstream.arrayBuffer();
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  headers.set('cache-control', 'public, max-age=3600');
  applySecurityHeaders(headers);
  return new Response(body, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Universal Links / Digital Asset Links. Fix Content-Type before
    // anything else can claim the request. Not analytics-worthy.
    if (url.pathname === AASA_PATH || url.pathname === ASSETLINKS_PATH) {
      return handleWellKnownJson(request);
    }

    // Route, then run the edge pageview/404 capture on the outgoing
    // response (fire-and-forget; see capturePageview).
    let response;
    const activityMatch = url.pathname.match(ACTIVITY_PATH_RE);
    const referralMatch =
      activityMatch ? null : url.pathname.match(REFERRAL_PATH_RE);
    if (activityMatch) {
      response = await handleActivity(request, activityMatch[1], url, env);
    } else if (referralMatch) {
      response = await handleReferral(
        request,
        referralMatch[1].toLowerCase(),
        env,
      );
    } else {
      // Passthrough. Still attach security headers so the marketing site
      // gets HSTS / CSP / nosniff coverage uniformly.
      response = withSecurityHeaders(await fetch(request));
    }

    capturePageview(request, url, response, env, ctx);
    return response;
  },
};

async function handleActivity(request, activityId, url, env) {
  const refCode = (url.searchParams.get('r') || '').trim();
  const anonKey = env.SUPABASE_ANON_KEY;

  const activity = await fetchActivity(activityId, anonKey);
  if (!activity) {
    // Couldn't find / load, fall through to the origin's 404.html.
    // Its client-side JS still renders a generic activity card.
    return withSecurityHeaders(await fetch(request));
  }

  // Parallel: sender name (optional, gated on ?r=) + 3 related activities.
  // Sender name comes from the SECURITY DEFINER RPC `get_referrer_first_name`
  // (migration 027), narrowly-scoped, callable with the anon key, returns
  // only the first whitespace-token of `profiles.name`. This replaced an
  // earlier service-role-key path that would have bypassed ALL RLS.
  const [senderName, related] = await Promise.all([
    refCode ? fetchSenderName(refCode, anonKey) : Promise.resolve(null),
    fetchRelated(activity, anonKey),
  ]);

  const originResponse = await fetch(request);
  const canonicalUrl = buildCanonicalUrl(activityId, refCode);
  const meta = buildMeta(activity, canonicalUrl, refCode);
  const cardHtml = buildActivityCardHtml({
    activity,
    activityId,
    refCode,
    senderName,
    related,
  });

  const rewritten = new HTMLRewriter()
    .on('head title', { element(el) { el.remove(); } })
    .on('head meta[name="description"]', { element(el) { el.remove(); } })
    .on('head meta[property^="og:"]', { element(el) { el.remove(); } })
    .on('head meta[name^="twitter:"]', { element(el) { el.remove(); } })
    .on('head meta[name="robots"]', { element(el) { el.remove(); } })
    .on('head meta[name="apple-itunes-app"]', { element(el) { el.remove(); } })
    .on('head', { element(el) { el.append(meta, { html: true }); } })
    // Replace the existing #activity-page card with a fully pre-rendered
    // one. The 404.html stub keeps a hidden #activity-page node so this
    // selector resolves; our replacement is visible (no `hidden` class).
    .on('#activity-page', {
      element(el) {
        el.replace(cardHtml, { html: true });
      },
    })
    .transform(originResponse);

  const headers = new Headers(rewritten.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'public, max-age=300, s-maxage=300');
  headers.set('x-bunnypath-og', 'rendered');
  applySecurityHeaders(headers);

  return new Response(rewritten.body, { status: 200, headers });
}

async function handleReferral(request, code, env) {
  const upperCode = code.toUpperCase();
  const e = htmlEscape;
  const anonKey = env && env.SUPABASE_ANON_KEY;
  // Pre-compute the iOS App Store URL with the campaign token so the
  // top-nav "Get the app" CTA can use it (HTMLRewriter handler below).
  // The card body recomputes the same URL inside `buildReferralCardBody`
  // kept duplicate to avoid a wider refactor; both yield the same URL.
  const iosUrl = `https://apps.apple.com/app/id${APP_STORE_ID}?mt=8&ct=REF_${e(upperCode)}`;

  // Build the OG/meta block first, it always ships, even if SSR card
  // generation falls through. Includes the smart app banner with the
  // ref code in app-argument so iOS Safari surfaces a one-tap install.
  // The `noindex,nofollow` robots meta is critical: referral landing
  // pages expose a sender's first name in the OG description, so we
  // never want them indexed by Google.
  const appArg = `bunnypath://ref/${upperCode}`;
  const meta = `\n` +
    `<title>You're invited to Bunny Path</title>\n` +
    `<meta name="robots" content="noindex,nofollow">\n` +
    `<meta name="description" content="Get a free month of Premium with code ${e(upperCode)}. 20,000+ off-screen play ideas for kids 0-12.">\n` +
    `<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, app-argument=${e(appArg)}">\n` +
    `<meta property="og:type" content="website">\n` +
    `<meta property="og:url" content="${SITE_ORIGIN}/${e(code)}">\n` +
    `<meta property="og:site_name" content="Bunny Path">\n` +
    `<meta property="og:title" content="You're invited to Bunny Path">\n` +
    `<meta property="og:description" content="Get a free month of Premium with code ${e(upperCode)}. 20,000+ off-screen play ideas for kids 0-12.">\n` +
    `<meta property="og:image" content="${OG_IMAGE}">\n` +
    `<meta property="og:image:width" content="512">\n` +
    `<meta property="og:image:height" content="512">\n` +
    `<meta property="og:image:alt" content="Bunny Path">\n` +
    `<meta name="twitter:card" content="summary_large_image">\n` +
    `<meta name="twitter:title" content="You're invited to Bunny Path">\n` +
    `<meta name="twitter:description" content="Get a free month of Premium with code ${e(upperCode)}. 20,000+ off-screen play ideas for kids 0-12.">\n` +
    `<meta name="twitter:image" content="${OG_IMAGE}">\n`;

  // Hide the legacy hidden card siblings so the path-routing JS in the
  // origin can't race-unhide the wrong card after our SSR'd one paints.
  const siblingHide = `<style id="bp-ssr-hide">#activity-page,#generic-page{display:none !important;}</style>`;

  // Critical CSS for the referral card, injected into <head> per spec
  // ("single critical CSS block inlined in <head>"), separate from the
  // body markup so we get a clean paint and valid HTML structure.
  const referralStyles = buildReferralCardStyles();

  // Kick off origin fetch in parallel with the Supabase calls, they're
  // independent, no point serializing them.
  const originPromise = fetch(request);

  try {
    // Parallel: sender name + curated activities preview. Sender stays
    // on a tight 2s budget (it gates the entire SSR card paint and is
    // user-blocking through `Promise.all`); the featured row gets 4s
    // because the Supabase `activities` query can be cold-slow on the
    // first call and falls behind a 5-min edge cache once primed.
    // Either timing out just drops the corresponding section.
    const [senderName, featured, originResponse] = await Promise.all([
      // Bumped 2000 → 4000 → 10000ms in stages: 4s was still firing during
      // the embedding-backfill window because three concurrent UPDATE
      // streams saturate Supabase's connection pool and slow read-side
      // fetches. 10s ensures the sender bar renders reliably even under
      // contention. The card paint waits on this, but Promise.all also
      // races against the origin fetch + featured query, and warm-cache
      // requests still resolve in well under 1s.
      // Bumped 10s → 20s. Embedding backfill loops are still running and
      // saturate the connection pool intermittently. The edge cache below
      // (`cf.cacheTtl: 300`) makes this hit DB only once per 5-min window
      // per code, so the slow path is rare. CF workers have a 30s hard
      // wall, so 20s leaves margin for the rest of the SSR work.
      withTimeout((signal) => fetchSenderName(code, anonKey, signal), 20000, null),
      withTimeout((signal) => fetchFeaturedActivities(anonKey, signal), 20000, []),
      originPromise,
    ]);

    const cardBody = buildReferralCardBody({ code, senderName, featured });

    const rewritten = new HTMLRewriter()
      .on('head title', { element(el) { el.remove(); } })
      .on('head meta[name="description"]', { element(el) { el.remove(); } })
      .on('head meta[property^="og:"]', { element(el) { el.remove(); } })
      .on('head meta[name^="twitter:"]', { element(el) { el.remove(); } })
      .on('head meta[name="robots"]', { element(el) { el.remove(); } })
      .on('head meta[name="apple-itunes-app"]', { element(el) { el.remove(); } })
      .on('head', { element(el) {
        el.append(meta, { html: true });
        el.append(referralStyles, { html: true });
        el.append(siblingHide, { html: true });
      }})
      // Match the worker-page nav to index.html's top chrome (logo left,
      // 'Download free' CTA on the right). Brings the referral page
      // visually in line with the marketing site so users feel they're
      // on the same brand surface, not a one-off landing.
      .on('body > nav', {
        element(el) {
          el.replace(
            `<nav class="top"><div class="container nav-inner">` +
              `<a href="/" class="logo" aria-label="Bunny Path"><img src="/assets/logo.png" alt="Bunny Path"></a>` +
              `<div class="nav-right">` +
                `<a href="/" class="nav-cta">Download free</a>` +
              `</div>` +
            `</div></nav>`,
            { html: true },
          );
        },
      })
      // Replace the hidden #referral-page node with a fully pre-rendered
      // card. The replacement does NOT carry the `hidden` class, so it
      // paints on first frame with no JS hydration.
      .on('#referral-page', { element(el) { el.replace(cardBody, { html: true }); } })
      .transform(originResponse);

    const headers = new Headers(rewritten.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'public, max-age=300, s-maxage=300');
    headers.set('x-robots-tag', 'noindex, nofollow');
    headers.set('x-bunnypath-og', 'rendered-referral-v5');
    applySecurityHeaders(headers);

    return new Response(rewritten.body, { status: 200, headers });
  } catch (err) {
    // SSR path failed for some reason, fall back to meta-only swap so
    // crawlers still get the OG tags and the client-side JS hydrates the
    // legacy card. Same behavior as before this redesign. Log the error
    // so it surfaces in `wrangler tail`.
    console.error('[referral SSR] error:', err);
    const originResponse = await originPromise;
    const rewritten = new HTMLRewriter()
      .on('head title', { element(el) { el.remove(); } })
      .on('head meta[name="description"]', { element(el) { el.remove(); } })
      .on('head meta[property^="og:"]', { element(el) { el.remove(); } })
      .on('head meta[name^="twitter:"]', { element(el) { el.remove(); } })
      .on('head meta[name="robots"]', { element(el) { el.remove(); } })
      .on('head meta[name="apple-itunes-app"]', { element(el) { el.remove(); } })
      .on('head', { element(el) { el.append(meta, { html: true }); } })
      .transform(originResponse);

    const headers = new Headers(rewritten.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'public, max-age=300, s-maxage=300');
    headers.set('x-robots-tag', 'noindex, nofollow');
    headers.set('x-bunnypath-og', 'rendered-referral-fallback');
    applySecurityHeaders(headers);

    return new Response(rewritten.body, { status: 200, headers });
  }
}

// Race a fetch-backed task against a timeout, with a real AbortController
// so the underlying fetch is cancelled when the timer wins (otherwise the
// abandoned subrequest keeps eating socket + CPU budget on the isolate).
// `task` is a function `(signal) => Promise<T>`; on timeout we abort the
// signal and resolve with the fallback. Supabase hiccups should never
// take down the referral landing page.
function withTimeout(task, ms, fallback) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { controller.abort(); } catch (_) { /* no-op */ }
      resolve(fallback);
    }, ms);
    let p;
    try {
      p = Promise.resolve(task(controller.signal));
    } catch (err) {
      if (!settled) { settled = true; clearTimeout(t); resolve(fallback); }
      console.error('[withTimeout] task threw synchronously:', err);
      return;
    }
    p.then(
      (v) => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(t);
          resolve(fallback);
          // Abort errors from our own timer aren't worth logging.
          if (!(err && err.name === 'AbortError')) {
            console.error('[withTimeout] task rejected:', err);
          }
        }
      },
    );
  });
}

// Hand-picked short_ids for the referral landing's "what's inside" preview
// row, one per type so the row reads as a mini-tour of the catalog
// (Discovery / Active / Creative). These are real curated activities
// (`is_curated=true`) selected for broad age-range appeal. Fetching by
// `short_id IN (...)` uses the unique short_id index and consistently
// returns in <2 s; the previous unfiltered + ordered queries were
// triggering Supabase statement timeouts and leaving this row empty.
const FEATURED_SHORT_IDS = ['225zc', '22bkc', '22bks'];

// Pull the curated preview-row activities. Returns [{short_id, emoji,
// title, age_range}, ...] or [] on any failure.
async function fetchFeaturedActivities(anonKey, signal) {
  if (!anonKey) return [];
  const select = 'short_id,title,type,age_range';
  const inList = FEATURED_SHORT_IDS.join(',');
  const endpoint = `${SUPABASE_URL}/rest/v1/activities` +
    `?short_id=in.(${inList})&select=${select}`;
  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        accept: 'application/json',
      },
      cf: { cacheTtl: 300, cacheEverything: true },
      signal,
    });
    if (!res.ok) return [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    // Preserve the editorially-chosen order, not whatever order
    // Postgres returns. Map by short_id, then walk the source list.
    const byId = new Map();
    for (const r of rows) {
      if (r && r.short_id) byId.set(r.short_id, r);
    }
    return FEATURED_SHORT_IDS
      .map((sid) => byId.get(sid))
      .filter(Boolean)
      .map((r) => ({
        short_id: r.short_id || '',
        emoji: typeEmoji(r.type),
        title: r.title || '',
        age_range: r.age_range || '',
      }));
  } catch (err) {
    if (!(err && err.name === 'AbortError')) {
      console.error('[fetchFeaturedActivities] error:', err);
    }
    return [];
  }
}

// Critical CSS for the referral card. Returned as a `<style>` block so it
// can be appended directly into `<head>` via HTMLRewriter (per spec, 
// "single critical CSS block inlined in <head>"). CSS vars fall back via
// local re-declaration so the card renders correctly even if the host
// page's :root vars are stripped or overridden.
function buildReferralCardStyles() {
  return `
<style id="rf-styles">
  :root {
    --cream:#FFFDF7; --cream-warm:#FFF3D9; --gold-pale:#FFF8ED;
    --gold:#F5A623; --gold-deep:#C47F0A; --gold-vibrant:#E8960F;
    --sage-soft:#BDDCC5; --sage-mid:#9CC9A6;
    --cocoa:#4A2B18;
    --charcoal:#1F2937; --charcoal-mid:#4B5563; --charcoal-light:#6B7280;
  }
  /* Page chrome, warm cream with a soft gold gradient blob top-right
     and a sage rolling-hill silhouette at the bottom. Mirrors the
     homepage's underlay rhythm so the referral page feels like the
     same brand surface, not a Substack post. */
  html, body { background: var(--cream); }
  body {
    font-family: 'Nunito', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: var(--charcoal);
    background:
      radial-gradient(60% 50% at 85% 0%, rgba(245,166,35,.18) 0%, rgba(245,166,35,0) 70%),
      radial-gradient(50% 40% at 10% 20%, rgba(255,231,160,.35) 0%, rgba(255,231,160,0) 70%),
      var(--cream);
    background-attachment: fixed;
  }
  /* Sage hill silhouette pinned to the bottom-left of the viewport, same
     palette + curve as the homepage hill stack, just one layer for the
     referral page to keep payload cheap. */
  body::after {
    content: '';
    position: fixed; left: -10%; right: -10%; bottom: 0;
    height: 140px;
    background:
      radial-gradient(120% 100% at 50% 100%, var(--sage-soft) 0%, var(--sage-soft) 55%, rgba(189,220,197,0) 70%);
    z-index: 0; pointer-events: none;
  }
  /* Origin nav already injects the real Bunny Path wordmark img. Keep it
     visible above the gradient blob. The 404.html stub also includes a
     <section class="main"><div class="container"> wrapper that we paint
     our card into. */
  nav, section.main, .container, footer { position: relative; z-index: 1; }
  /* Top-nav header (mirrors index.html's .nav.top so the referral page
     feels continuous with the marketing site). The HTMLRewriter swaps the
     404.html bare <nav> for an index-style nav.top with a logo on the
     left and a "Get the app" CTA on the right. */
  nav.top {
    position: sticky; top: 0; z-index: 50;
    padding: 10px 0;
    background: transparent; border-bottom: none;
  }
  nav.top .nav-inner {
    max-width: 1160px; margin: 0 auto; padding: 0 28px;
    display: flex; align-items: center; justify-content: space-between;
  }
  nav.top .logo {
    display: flex; align-items: center; gap: 10px;
    text-decoration: none; color: var(--charcoal);
  }
  nav.top .logo img {
    display: block; height: 150px; width: auto;
    margin: -22px 0 -50px;
    position: relative; z-index: 2;
  }
  nav.top .nav-right {
    display: flex; align-items: center; gap: 20px;
  }
  nav.top .nav-cta {
    background: #E37756; color: #fff;
    padding: 10px 22px; border-radius: 100px;
    text-decoration: none; font-weight: 700; font-size: 14px;
    box-shadow: 0 6px 18px rgba(227,119,86,.3);
    transition: transform .2s ease;
  }
  nav.top .nav-cta:hover { transform: translateY(-2px); }
  @media (max-width: 720px) {
    nav.top { padding: 8px 0; }
    nav.top .logo img { height: 92px; margin: -14px 0 -30px; }
    nav.top .nav-cta { padding: 9px 16px; font-size: 13px; }
  }
  /* Drop the activity-share <h1> "You've been invited..." stub that the
     404.html keeps for no-JS / no-worker fallbacks; our SSR card has its
     own headline and we don't want it flashing above ours. */
  h1#ref-heading { display: none; }
  #referral-page.rf-card {
    display: block; box-sizing: border-box;
    width: 100%; max-width: 460px;
    margin: 8px auto 24px; padding: 8px 4px 32px;
    background: transparent;
    font-family: 'Nunito', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: var(--charcoal);
    position: relative;
  }
  @media (min-width: 720px) {
    #referral-page.rf-card { max-width: 500px; padding: 16px 16px 48px; margin-top: 24px; }
  }
  /* Section A, sender bar. Single-line gold-tinted pill so it reads
     as a personal handoff, not a notification banner. */
  .rf-sender {
    display: flex; align-items: center; gap: 12px;
    background: linear-gradient(180deg, #FFF8ED 0%, #FFF1D6 100%);
    border: 1px solid rgba(245,166,35,.30);
    border-radius: 999px;
    padding: 10px 18px 10px 10px;
    margin: 0 0 22px;
    box-shadow: 0 6px 20px rgba(245,166,35,.14), 0 1px 2px rgba(0,0,0,.04);
  }
  .rf-avatar {
    flex: 0 0 38px; width: 38px; height: 38px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--gold), var(--gold-vibrant));
    color: #fff;
    display: inline-flex; align-items: center; justify-content: center;
    font-family: 'Fraunces', Georgia, serif; font-weight: 700; font-size: 18px;
    line-height: 1;
    box-shadow: 0 2px 8px rgba(245,166,35,.45);
  }
  .rf-sender-text { flex: 1; font-size: 15.5px; font-weight: 600; color: var(--charcoal); line-height: 1.3; }
  .rf-sender-text strong { font-weight: 800; }
  /* Hero card, the one big visual element. Soft warm gradient inside,
     gold border accent, generous radius. The real Bunny Path logo
     (PNG) sits inside, top-centered. */
  .rf-hero-card {
    background: linear-gradient(180deg, #fff 0%, var(--gold-pale) 100%);
    border: 1px solid rgba(245,166,35,.22);
    border-radius: 28px;
    padding: 28px 24px 32px;
    text-align: center;
    box-shadow: 0 10px 40px rgba(245,166,35,.15), 0 2px 6px rgba(0,0,0,.04);
    position: relative; overflow: hidden;
  }
  @media (min-width: 720px) {
    .rf-hero-card { padding: 36px 32px 40px; border-radius: 32px; }
  }
  .rf-hero-card::before {
    content: '';
    position: absolute; top: -60px; right: -60px;
    width: 200px; height: 200px;
    background: radial-gradient(circle, rgba(255,214,120,.45) 0%, rgba(255,214,120,0) 70%);
    pointer-events: none;
  }
  .rf-logo {
    display: block; width: 168px; max-width: 60%;
    height: auto; margin: 0 auto 4px;
    position: relative; z-index: 1;
  }
  @media (min-width: 720px) { .rf-logo { width: 200px; } }
  .rf-eyebrow {
    display: inline-block;
    font-family: 'Nunito', sans-serif; font-weight: 800;
    font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--gold-deep);
    background: rgba(245,166,35,.10);
    border-radius: 100px; padding: 5px 12px;
    margin: 0 0 14px;
    position: relative; z-index: 1;
  }
  .rf-h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 800; font-size: 32px; line-height: 1.05;
    letter-spacing: -0.02em;
    color: var(--cocoa);
    margin: 0 0 12px;
    position: relative; z-index: 1;
  }
  @media (min-width: 720px) { .rf-h1 { font-size: 40px; } }
  .rf-h1 em {
    font-style: italic; font-weight: 600;
    color: var(--gold-vibrant);
    background: linear-gradient(120deg, var(--gold-vibrant), var(--gold-deep));
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .rf-sub {
    font-family: 'Nunito', sans-serif;
    font-weight: 500; font-size: 16px;
    color: var(--charcoal-mid);
    margin: 0 auto 20px; max-width: 32ch; line-height: 1.5;
    position: relative; z-index: 1;
  }
  .rf-code-chip {
    display: inline-flex; align-items: center; gap: 8px;
    background: #fff;
    border: 2px dashed rgba(245,166,35,.5);
    color: var(--charcoal);
    font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 13px;
    padding: 9px 16px; border-radius: 12px;
    letter-spacing: 0.02em;
    position: relative; z-index: 1;
  }
  .rf-code-chip .rf-code-label { color: var(--charcoal-light); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; }
  .rf-code-chip strong { color: var(--gold-deep); font-family: 'Fraunces', Georgia, serif; font-weight: 800; font-size: 16px; letter-spacing: .08em; }
  .rf-code-note {
    display: block; font-size: 12px;
    color: var(--charcoal-light); margin-top: 8px;
    position: relative; z-index: 1;
  }
  /* Brand trust microbar, mirrors index.html's .hero-meta row (emoji +
     bold word + plain word). Sits on the cream surface, not in the hero
     card, so the hero stays uncluttered. Replaces the older check-mark
     row; the practical fine print ("No card to start · Cancel anytime")
     now lives below the CTA buttons in .rf-cta-caption where it acts as
     last-mile reassurance. */
  .rf-trust {
    display: flex; flex-direction: row; flex-wrap: wrap;
    justify-content: center; gap: 10px 22px;
    margin: 22px 0 22px;
    font-family: 'Nunito', sans-serif; font-weight: 600; font-size: 14px;
    color: var(--charcoal-light);
  }
  .rf-trust span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .rf-trust b { color: var(--charcoal); font-weight: 800; }
  @media (max-width: 379px) {
    .rf-trust { flex-direction: column; align-items: center; gap: 10px; }
  }
  /* Primary CTA stack, iOS + Android, identical height + width.
     Stacked on every breakpoint so both buttons keep the full headline
     and never need to truncate. Styling mirrors index.html's hero
     .store-btn pair: terracotta solid for iOS, white-with-border for
     Android, so the referral page reads as the same brand surface as
     the marketing site. */
  .rf-cta-stack {
    display: flex; flex-direction: column; gap: 10px;
    margin-top: 4px;
  }
  .rf-cta {
    display: inline-flex; align-items: center; justify-content: center;
    gap: 12px;
    width: 100%; height: 60px;
    border: 2px solid transparent;
    box-sizing: border-box;
    font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 16px;
    border-radius: 16px;
    text-decoration: none;
    transition: transform .2s ease, box-shadow .2s ease;
  }
  .rf-cta-ios {
    background: #E37756; color: #fff;
    box-shadow: 0 8px 24px rgba(227,119,86,.32);
  }
  .rf-cta-android {
    background: #fff; color: var(--charcoal);
    border-color: #E8E5DC;
    box-shadow: 0 4px 14px rgba(0,0,0,.05);
  }
  .rf-cta:hover { transform: translateY(-3px); }
  .rf-cta-ios:hover { box-shadow: 0 12px 30px rgba(227,119,86,.38); }
  .rf-cta-android:hover { box-shadow: 0 10px 22px rgba(0,0,0,.08); }
  .rf-cta-glyph { font-size: 22px; line-height: 1; }
  /* SVG glyph wrapper, sized to match index.html's .store-btn svg
     (22x22) so iOS + Android buttons feel like a balanced pair. */
  .rf-cta-glyph-svg {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; flex-shrink: 0;
  }
  .rf-cta-glyph-svg svg { display: block; width: 22px; height: 22px; }
  .rf-cta-caption {
    text-align: center; margin: 14px 0 0;
    font-family: 'Nunito', sans-serif; font-weight: 600; font-size: 13px;
    color: var(--charcoal-light);
  }
  .rf-cta-caption .rf-dot { color: rgba(31,41,55,.25); margin: 0 6px; }
  /* Featured activities preview, Section E. Soft section header, then a
     horizontally scrollable row of three cards. Sage-tinted background
     band sits behind the row to feel like a curated gallery. */
  .rf-featured-wrap {
    margin: 36px -8px 0; padding: 22px 8px 8px;
    background: linear-gradient(180deg, rgba(189,220,197,.18) 0%, rgba(189,220,197,0) 100%);
    border-radius: 20px;
  }
  .rf-featured-h {
    text-align: center; margin: 0 0 14px;
    font-family: 'Fraunces', Georgia, serif; font-weight: 700; font-size: 17px;
    color: var(--cocoa); letter-spacing: -.01em;
  }
  .rf-featured-h em {
    font-style: italic; color: var(--gold-deep); font-weight: 600;
  }
  .rf-featured {
    display: flex; flex-direction: row; gap: 12px;
    padding: 4px 12px 12px;
    overflow-x: auto; -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }
  .rf-featured::-webkit-scrollbar { display: none; }
  .rf-feat-card {
    flex: 0 0 150px; width: 150px; min-height: 168px;
    background: #fff;
    border: 1px solid rgba(0,0,0,.05);
    border-radius: 16px;
    padding: 14px 14px 16px;
    display: flex; flex-direction: column; gap: 10px;
    text-decoration: none; color: var(--charcoal);
    scroll-snap-align: start;
    box-shadow: 0 4px 14px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.02);
    transition: transform .15s ease, box-shadow .15s ease;
  }
  .rf-feat-card:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(245,166,35,.18); }
  .rf-feat-emoji {
    font-size: 32px; line-height: 1;
    width: 48px; height: 48px;
    border-radius: 14px;
    background: var(--gold-pale);
    display: inline-flex; align-items: center; justify-content: center;
  }
  .rf-feat-title {
    font-family: 'Fraunces', Georgia, serif; font-weight: 700; font-size: 14px;
    line-height: 1.25; color: var(--cocoa);
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    overflow: hidden; text-overflow: ellipsis;
    flex: 1;
  }
  .rf-feat-pill {
    align-self: flex-start;
    background: var(--gold-pale); color: var(--gold-deep);
    font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 11px;
    padding: 4px 9px; border-radius: 100px;
    letter-spacing: .02em;
  }
  /* Reciprocity microcopy under the featured row. */
  .rf-reciprocity {
    text-align: center; margin: 22px 0 0;
    font-family: 'Nunito', sans-serif; font-weight: 500; font-size: 13px;
    color: var(--charcoal-light); font-style: italic;
  }
  .rf-reciprocity strong { color: var(--gold-deep); font-style: normal; font-weight: 700; }
  /* Hide the origin's homepage <footer>'s gold-vibrant hover, actually
     we KEEP the origin footer (single source of truth for nav links)
     and just style it a touch warmer to match the page. */
  body > footer {
    margin-top: 12px;
    padding-bottom: calc(40px + env(safe-area-inset-bottom));
  }
</style>`;
}

// Card markup (no <style> tag). Returns the full `<div id="referral-page">`
// body that replaces the hidden stub from the origin's 404.html. Critical
// CSS lives in `buildReferralCardStyles()` and is injected into <head>
// separately so we keep <body> free of stray <style> nodes.
function buildReferralCardBody({ code, senderName, featured }) {
  const e = htmlEscape;
  const upperCode = String(code).toUpperCase();
  const safeName = senderName ? e(senderName) : '';
  // Surrogate-safe first-character pick: `charAt(0)` returns a lone
  // surrogate for emoji / supplementary-plane names, which renders as
  // a broken glyph in the avatar. Iterate the string by code point
  // instead, then uppercase + escape.
  const firstChar = senderName ? ([...senderName][0] ?? '?') : '';
  const initial = senderName ? e(firstChar.toUpperCase()) : '';

  // Section A, sender bar. Drop entirely when there's no real name.
  // Single-line treatment: gold avatar + "{Name} sent you a free month".
  // Reverted from the earlier eyebrow + two-line pattern per design
  // feedback ("the content is right, but the previous look was not great").
  // Cleaner pill, less notification-banner, more chat-message-preview.
  const senderBar = senderName
    ? `<div class="rf-sender">
         <span class="rf-avatar">${initial}</span>
         <span class="rf-sender-text"><strong>${safeName}</strong> sent you a free month</span>
       </div>`
    : '';

  // Section E. Featured activities row. Renders whenever we have at
  // least one curated activity back from Supabase. Strict-3 gating
  // (the previous behavior) combined with the now-fixed query was
  // turning this row off entirely; one or two cards still tells the
  // "real catalog" story.
  const featuredCards = (Array.isArray(featured) ? featured : []).filter(
    (f) => f && f.short_id,
  );
  const featuredRow = featuredCards.length
    ? `<div class="rf-featured-wrap">
         <h2 class="rf-featured-h">A taste of <em>what's inside</em></h2>
         <div class="rf-featured">
           ${featuredCards.map((f) => {
             const href = `/a/${e(f.short_id)}?r=${e(code)}`;
             const emoji = f.emoji || '✨';
             const ageBit = f.age_range ? `<span class="rf-feat-pill">Ages ${e(f.age_range)}</span>` : '';
             return `<a class="rf-feat-card" href="${e(href)}">
               <span class="rf-feat-emoji">${emoji}</span>
               <span class="rf-feat-title">${e(f.title)}</span>
               ${ageBit}
             </a>`;
           }).join('')}
         </div>
       </div>`
    : '';

  // Section F, reciprocity microcopy. Only when senderName is non-null.
  const reciprocity = senderName
    ? `<p class="rf-reciprocity"><strong>${safeName} earns a free month too</strong> once you have been here a week. Tiny win for both of you.</p>`
    : '';

  const iosUrl = `https://apps.apple.com/app/id${APP_STORE_ID}?mt=8&ct=REF_${e(upperCode)}`;
  // Google Play install with the referral code in the `referrer` query
  // param. The Android app reads this on first run and auto-applies the
  // promo (mirrors the iOS `ct=` campaign-token pattern).
  const androidPlayUrl = `https://play.google.com/store/apps/details?id=${ANDROID_BUNDLE}&referrer=${encodeURIComponent(`ref=${e(upperCode)}`)}`;

  // Headline reads warmer + uses an italic emphasis on the gift words
  // (rendered with a gold gradient via .rf-h1 em). The literal logo
  // image (the chunky illustrated wordmark, /assets/logo.png, same
  // asset the homepage nav uses) anchors the hero. We still ship the
  // origin's <nav> with the logo above the card, but a smaller in-card
  // logo makes the hero card feel branded on its own when share-card
  // screenshots crop it out of context.
  return `
<div id="referral-page" class="rf-card">
  ${senderBar}
  <div class="rf-hero-card">
    <img class="rf-logo" src="/assets/logo.png" alt="Bunny Path" width="360" height="360" loading="eager" decoding="async">
    <span class="rf-eyebrow">A little gift</span>
    <h1 class="rf-h1">A free month of <em>Bunny Path</em> Premium, on us.</h1>
    <p class="rf-sub">20,000+ off-screen play ideas, hand-picked for ages 0&ndash;12. No more "I'm bored."</p>
    <span class="rf-code-chip">
      <span class="rf-code-label">Your code</span>
      <strong>${e(upperCode)}</strong>
    </span>
    <span class="rf-code-note">Auto-pasted when you install &mdash; nothing to type.</span>
  </div>
  <div class="rf-trust">
    <span>&#x2764;&#xFE0F; <b>Built</b> by parents like you</span>
    <span>&#x1F6E1;&#xFE0F; <b>100%</b> Wholesome</span>
    <span>&#x2702;&#xFE0F; <b>Zero</b> screen time</span>
  </div>
  <div class="rf-cta-stack">
    <a class="rf-cta rf-cta-ios" href="${e(iosUrl)}" aria-label="Download for iPhone">
      <span class="rf-cta-glyph rf-cta-glyph-svg" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.04c-.03-2.89 2.36-4.28 2.47-4.35-1.35-1.97-3.45-2.24-4.19-2.27-1.78-.18-3.48 1.05-4.39 1.05-.92 0-2.31-1.03-3.8-1-1.95.03-3.76 1.14-4.76 2.88-2.04 3.54-.52 8.78 1.46 11.66.97 1.41 2.12 3 3.61 2.94 1.45-.06 2-.94 3.75-.94 1.75 0 2.24.94 3.77.91 1.56-.03 2.55-1.44 3.5-2.86 1.12-1.64 1.58-3.23 1.6-3.32-.03-.01-3.06-1.17-3.02-4.7zM14.2 3.9c.8-.97 1.34-2.31 1.19-3.65-1.15.05-2.54.77-3.37 1.73-.74.85-1.4 2.22-1.22 3.53 1.28.1 2.6-.65 3.4-1.61z"/></svg>
      </span>
      <span>Download for iPhone</span>
    </a>
    <a class="rf-cta rf-cta-android" href="${e(androidPlayUrl)}" aria-label="Download for Android">
      <span class="rf-cta-glyph rf-cta-glyph-svg" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M3.18 2.57c-.36.36-.56.93-.56 1.67v15.52c0 .74.2 1.31.56 1.67l.09.08 8.7-8.7v-.16L3.27 2.48l-.09.09z" fill="#5BC9F4"/><path d="M15.13 15.69l-2.9-2.9v-.16l2.9-2.9.07.04 3.43 1.95c.98.56.98 1.47 0 2.03l-3.43 1.95-.07-.01z" fill="#FEE101"/><path d="M15.2 15.68L12.23 12.7 3.18 21.77c.33.33.85.37 1.45.04l10.57-6.13" fill="#EA4335"/><path d="M15.2 8.32L4.63 2.19c-.6-.33-1.12-.29-1.45.04l9.05 9.05 2.97-2.96z" fill="#34A853"/></svg>
      </span>
      <span>Download for Android</span>
    </a>
    <p class="rf-cta-caption">No card to start<span class="rf-dot">&middot;</span>Cancel anytime<span class="rf-dot">&middot;</span>Off-screen only</p>
  </div>
  ${featuredRow}
  ${reciprocity}
</div>`;
}

async function fetchActivity(id, anonKey) {
  if (!anonKey) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const isShortId = /^[abcdefghjkmnpqrstvwxyz23456789]{5}$/i.test(id);
  if (!isUuid && !isShortId) return null;

  const lookupKey = isUuid ? 'id' : 'short_id';
  const lookupValue = isUuid ? id : id.toLowerCase();
  // Pull the full set of fields the rich landing page needs.
  const select = 'id,short_id,title,description,type,time,age_range,age_bracket,materials,steps,benefits';
  const endpoint = `${SUPABASE_URL}/rest/v1/activities?${lookupKey}=eq.${encodeURIComponent(lookupValue)}&select=${select}`;
  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        accept: 'application/json',
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
  } catch (_) {
    return null;
  }
}

async function fetchRelated(activity, anonKey) {
  if (!anonKey || !activity || !activity.age_range || !activity.id) return [];
  const select = 'id,short_id,title,type,age_range';
  // Same age_range, exclude current row, limit 3. Cheap thanks to the
  // age_range index added in migration 016.
  const endpoint = `${SUPABASE_URL}/rest/v1/activities` +
    `?age_range=eq.${encodeURIComponent(activity.age_range)}` +
    `&id=neq.${encodeURIComponent(activity.id)}` +
    `&is_curated=eq.true` +
    `&order=created_at.desc&limit=3&select=${select}`;
  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        accept: 'application/json',
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

async function fetchSenderName(refCode, anonKey, signal) {
  if (!refCode || !anonKey) {
    console.log('[fetchSenderName] skipped, refCode:', !!refCode, 'anonKey:', !!anonKey);
    return null;
  }
  // Defense: reject anything that doesn't fit the 6-char base32 referral
  // shape before we send it to the DB. The RPC also filters internally
  // (it uses upper(trim(?))) but cheap to enforce here too.
  if (!/^[abcdefghjkmnpqrstvwxyz23456789]{6}$/i.test(refCode)) {
    console.log('[fetchSenderName] regex reject:', refCode);
    return null;
  }
  // Sender attribution goes through `public.get_referrer_first_name`, a
  // SECURITY DEFINER RPC created by migration 027. The function reads
  // past `profiles` RLS *internally* but only returns the first
  // whitespace-token of `name` (e.g. "Sarah Smith" → "Sarah") or null.
  // Callable by anon, no service-role key needed, blast radius is one
  // first name per known referral code even if the Worker is compromised.
  //
  // Edge-cache for 5 min per `(code, body)` cache key. The cache is the
  // critical resilience here: under DB contention (e.g. concurrent
  // embedding backfill writes saturating Supabase's connection pool),
  // the first cold-path fetch may take 8-12s; once cached, subsequent
  // visits to the same /CODE return instantly without touching the DB.
  // The earlier theory that "the cache is pinning a failed response"
  // was wrong. The real failure was a stale anon-key secret. Now that
  // the key is current, the cache is purely a perf win.
  const t0 = Date.now();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_referrer_first_name`,
      {
        method: 'POST',
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ p_code: refCode }),
        cf: { cacheTtl: 300, cacheEverything: true },
        signal,
      },
    );
    if (!res.ok) {
      console.log('[fetchSenderName] non-ok:', res.status, 'in', Date.now() - t0, 'ms');
      return null;
    }
    const result = await res.json();
    if (typeof result !== 'string') {
      console.log('[fetchSenderName] non-string result:', JSON.stringify(result).slice(0, 100), 'in', Date.now() - t0, 'ms');
      return null;
    }
    const trimmed = result.trim();
    console.log('[fetchSenderName] ok:', trimmed || '(empty)', 'in', Date.now() - t0, 'ms');
    return trimmed === '' ? null : trimmed;
  } catch (err) {
    console.log('[fetchSenderName] err:', err && err.name, err && err.message, 'in', Date.now() - t0, 'ms');
    return null;
  }
}

function buildCanonicalUrl(id, refCode) {
  const base = `${SITE_ORIGIN}/a/${id}`;
  return refCode ? `${base}?r=${encodeURIComponent(refCode)}` : base;
}

function buildMeta(activity, canonicalUrl, refCode) {
  const rawTitle = (activity.title || 'Activity').toString();
  const rawDescription = (activity.description || '').toString();
  const title = `${rawTitle}, Bunny Path`;
  const shortDesc = clip(rawDescription, 150) || 'A hand-crafted, off-screen play idea on Bunny Path.';
  const ogDesc = clip(rawDescription, 200) || 'A hand-crafted, off-screen play idea on Bunny Path.';

  const t = htmlEscape(title);
  const d150 = htmlEscape(shortDesc);
  const d200 = htmlEscape(ogDesc);
  const u = htmlEscape(canonicalUrl);

  // Smart App Banner, iOS Safari one-tap install. `app-argument` carries
  // the activity short_id (and ref code if present) so the app can deep
  // link into the exact activity post-install.
  const sid = activity.short_id || activity.id || '';
  const appArg = sid
    ? `${SITE_ORIGIN}/a/${sid}${refCode ? `?r=${encodeURIComponent(refCode)}` : ''}`
    : SITE_ORIGIN;

  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d150}">`,
    `<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, app-argument=${htmlEscape(appArg)}">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d200}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:url" content="${u}">`,
    `<meta property="og:site_name" content="Bunny Path">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    `<meta property="og:image:width" content="512">`,
    `<meta property="og:image:height" content="512">`,
    `<meta property="og:image:alt" content="Bunny Path">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d200}">`,
    `<meta name="twitter:image" content="${OG_IMAGE}">`,
  ].join('\n');
}

// Type-emoji map. Types are constrained to these three strings (see CLAUDE.md).
const TYPE_EMOJI = {
  'Active play': '🏃',
  'Discovery': '🔍',
  'Creative': '🎨',
};

function typeEmoji(type) {
  return TYPE_EMOJI[type] || '✨';
}

// User-facing verb labels for the stored DB type values. DB keeps
// 'Active play' / 'Discovery' / 'Creative' / 'Puzzle'; customers see
// Play / Discover / Create / Solve (matches the app's displayLabel and 404.html).
const TYPE_LABEL = {
  'Active play': 'Play',
  'Discovery': 'Discover',
  'Creative': 'Create',
  'Puzzle': 'Solve',
};

function typeLabel(type) {
  return TYPE_LABEL[type] || type;
}

function buildActivityCardHtml({ activity, activityId, refCode, senderName, related }) {
  const e = htmlEscape;
  const title = activity.title || 'A play idea';
  const description = activity.description || '';
  const type = activity.type || '';
  const time = activity.time || '';
  const ageRange = activity.age_range || '';
  const ageBracket = activity.age_bracket || '';
  const sid = activity.short_id || activityId;

  const materials = Array.isArray(activity.materials) ? activity.materials : [];
  const steps = Array.isArray(activity.steps) ? activity.steps : [];
  const benefits = Array.isArray(activity.benefits) ? activity.benefits : [];

  // Materials and steps were migrated from text[] to jsonb (migration
  // 094). New rows store each material as {item, ...} and each step as
  // {instruction, duration, tip, ...}. Older rows may still be plain
  // strings. These tiny helpers extract the display string from either
  // shape — without them, `String(obj)` renders the literal text
  // '[object Object]' on the share page.
  const materialText = (m) =>
    m == null ? '' : (typeof m === 'string' ? m : (m.item || m.material_text || m.text || ''));
  const stepText = (s) =>
    s == null ? '' : (typeof s === 'string' ? s : (s.instruction || s.text || ''));
  const benefitText = (b) =>
    b == null ? '' : (typeof b === 'string' ? b : (b.benefit_text || b.text || b.title || ''));
  const totalSteps = steps.length;
  const visibleSteps = steps.slice(0, 2);
  const blurredSteps = steps.slice(2);

  // ── Sender attribution (Section 1) ───────────────────────────────────
  // Only render when both ?r= and a real name lookup succeeded. Anything
  // less is silently dropped, never a generic "Someone shared this".
  const senderBar = senderName
    ? `<div class="sender-bar"><strong>${e(senderName)}</strong> shared this with you 🐇</div>`
    : '';

  // ── Hero (Section 2) ─────────────────────────────────────────────────
  const pills = [];
  if (type) pills.push(`<span class="activity-meta-pill">${typeEmoji(type)} ${e(typeLabel(type))}</span>`);
  if (time) pills.push(`<span class="activity-meta-pill">⏱ ${e(time)}</span>`);
  if (ageRange) pills.push(`<span class="activity-meta-pill">👶 Ages ${e(ageRange)}</span>`);

  // ── Description (Section 3), full, no truncation ───────────────────
  const descBlock = description
    ? `<p class="activity-description">${e(description)}</p>`
    : '';

  // ── Materials (Section 4) ───────────────────────────────────────────
  const materialsBlock = materials.length
    ? `<div class="activity-section">
         <h2 class="activity-section-h">You'll need</h2>
         <ul class="bullet-list">
           ${materials.map((m) => `<li>${e(materialText(m))}</li>`).join('')}
         </ul>
       </div>`
    : '';

  // ── Steps (Section 5). First 2 clear, rest blurred + locked ────────
  let stepsBlock = '';
  if (steps.length) {
    const visibleHtml = visibleSteps
      .map((s, i) => `<li><span class="step-num">${i + 1}</span><span>${e(stepText(s))}</span></li>`)
      .join('');
    const blurredHtml = blurredSteps.length
      ? blurredSteps
          .map((s, i) => `<li class="step-locked"><span class="step-num">${i + 3}</span><span>${e(stepText(s))}</span></li>`)
          .join('')
      : '';
    // Gate text, broadened from the per-activity-age cohort wording to
    // a corpus-wide "ages 0–12" framing per owner direction (the
    // referral landing should sell the whole product, not just the
    // narrow age slice of the activity that was shared). Keeps the
    // call-to-download but drops the 7-step / age-specific specificity
    // that was reading as gating rather than inviting.
    const gateText = blurredSteps.length
      ? `Download the app to see all steps + other similar activities for ages 0–12.`
      : `Download the app to see all steps + other similar activities for ages 0–12.`;
    // The blurred-and-locked block is a separate <ol> after the visible
    // <ol> rather than a <div> nested inside <ol> (which would be invalid
    // markup). The wrapper provides the positioning context for the
    // overlay.
    const lockedBlock = blurredHtml
      ? `<div class="step-blur-wrap">
           <ol class="step-list step-list-locked" start="3">${blurredHtml}</ol>
           <div class="step-lock-overlay"><span class="lock-icon">🔒</span><span class="lock-text">${e(gateText)}</span></div>
         </div>`
      : '';
    stepsBlock = `
       <div class="activity-section">
         <h2 class="activity-section-h">How to play</h2>
         <ol class="step-list">${visibleHtml}</ol>
         ${lockedBlock}
       </div>`;
  }

  // ── Benefits (Section 6) ────────────────────────────────────────────
  // Renders ALL benefits (no slice). Activities typically carry 3–8
  // benefits; capping at 6 silently dropped longer lists, which the
  // user-visible page should not do (the in-app detail screen doesn't
  // truncate, and parents reading the referral page deserve the same
  // signal).
  const benefitsBlock = benefits.length
    ? `<div class="activity-section">
         <h2 class="activity-section-h">What kids gain</h2>
         <ul class="bullet-list bullet-list-sparkle">
           ${benefits.map((b) => `<li>${e(benefitText(b))}</li>`).join('')}
         </ul>
       </div>`
    : '';

  // ── Cohort prompt (Play B), between benefits and CTAs ──────────────
  const cohortPrompt = `
       <div class="cohort-prompt" id="cohort-prompt">
         <p class="cohort-q">Who are you finding activities for?</p>
         <div class="cohort-row">
           <button class="cohort-chip" data-cohort="toddler" data-label="Toddler">Toddler · 1–3</button>
           <button class="cohort-chip" data-cohort="preschool" data-label="Preschool">Preschool · 3–5</button>
           <button class="cohort-chip" data-cohort="school-age" data-label="School-age">School-age · 5–12</button>
         </div>
       </div>`;

  // ── Related (Section 7) ─────────────────────────────────────────────
  const relatedBlock = (related && related.length)
    ? `<div class="activity-section related-section">
         <h2 class="activity-section-h">More for ages 0-12 years</h2>
         <div class="related-grid">
           ${related.map((r) => {
              const rsid = e(r.short_id || r.id);
              const rurl = `/a/${rsid}${refCode ? `?r=${encodeURIComponent(refCode)}` : ''}`;
              return `<a class="related-card" href="${e(rurl)}">
                <span class="related-emoji">${typeEmoji(r.type)}</span>
                <span class="related-title">${e(r.title || '')}</span>
                ${r.type ? `<span class="related-pill">${e(typeLabel(r.type))}</span>` : ''}
              </a>`;
           }).join('')}
         </div>
       </div>`
    : '';

  // ── Below-the-fold social proof (Section 10) ────────────────────────
  const socialProof = `
       <div class="social-proof-strip">
         <p><strong>20,000+ activities curated by parents and child-development specialists.</strong></p>
         <p>Off-screen, educational, guilt-free. Built by parents like you 🧡</p>
       </div>`;

  // ── CTA row (Play C), iPhone / Android / Text me ───────────────────
  // Final href values get wired client-side based on userAgent (iOS vs
  // Android), so SSR ships sane defaults; the JS upgrades them.
  const smsBody = `Bunny Path app, ${SITE_ORIGIN}/a/${sid}${refCode ? `?r=${refCode}` : ''}`;
  const mailBody = `Try this activity: ${SITE_ORIGIN}/a/${sid}${refCode ? `?r=${refCode}` : ''}`;
  const smsHref = `sms:?body=${encodeURIComponent(smsBody)}`;
  const mailHref = `mailto:?subject=${encodeURIComponent('Bunny Path')}&body=${encodeURIComponent(mailBody)}`;

  // Pre-build store URLs server-side so even no-JS fallback works.
  const campaignToken = `ACT_${activityId}${refCode ? `_REF_${refCode}` : ''}`;
  const iosUrl = `https://apps.apple.com/app/id${APP_STORE_ID}?mt=8&ct=${encodeURIComponent(campaignToken)}`;
  const androidReferrer = `activity=${activityId}${refCode ? `&ref=${refCode}` : ''}`;
  const androidUrl = `https://play.google.com/store/apps/details?id=${ANDROID_BUNDLE}&referrer=${encodeURIComponent(androidReferrer)}`;

  // Card data. Read by the page-side JS (cohort prompt, floating CTA
  // copy updates, UA-based ref-code clipboard handoff).
  const dataBlock = `<script type="application/json" id="bp-activity-data">${
    JSON.stringify({
      shortId: sid,
      refCode: refCode || '',
      ageBracket: ageBracket || '',
      iosUrl,
      androidUrl,
    }).replace(/</g, '\\u003c')
  }</script>`;

  // The whole card. Replaces the hidden #activity-page node from 404.html.
  return `
     <div class="card activity-card" id="activity-page">
       ${senderBar}
       <span class="card-emoji">${typeEmoji(type)}</span>
       <h1 class="activity-title">${e(title)}</h1>
       ${pills.length ? `<div class="activity-meta">${pills.join('')}</div>` : ''}
       ${descBlock}
       ${materialsBlock}
       ${stepsBlock}
       ${benefitsBlock}
       ${cohortPrompt}
       <a href="${e(iosUrl)}" class="btn-primary" id="activity-ios-btn" style="margin-top: 8px;">
         <span class="btn-icon">&#xF8FF;</span>
         <span class="btn-label">Download for iPhone</span>
       </a>
       <a href="${e(androidUrl)}" class="btn-secondary" id="activity-android-btn">
         <span class="btn-icon">&#x1F4F1;</span>
         <span class="btn-label">Download for Android</span>
       </a>
       <a href="${e(smsHref)}" class="btn-tertiary" id="activity-sms-btn">
         <span class="btn-icon">&#x1F4AC;</span>
         <span class="btn-label">Text me the link</span>
       </a>
       <a href="${e(mailHref)}" class="btn-tertiary-link" id="activity-mail-btn" data-activity-url="${e(`${SITE_ORIGIN}/a/${sid}${refCode ? `?r=${refCode}` : ''}`)}">Or email it to yourself</a>
       <div id="activity-mail-toast" role="status" aria-live="polite" style="position:fixed;left:50%;bottom:80px;transform:translate(-50%,8px);background:rgba(20,20,20,0.92);color:#fff;padding:10px 16px;border-radius:24px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;z-index:9999;pointer-events:none;opacity:0;transition:opacity .18s ease,transform .18s ease;max-width:90vw;text-align:center"></div>
       <script>(function(){
         var btn = document.getElementById('activity-mail-btn');
         var toast = document.getElementById('activity-mail-toast');
         if (!btn || !toast) return;
         function showToast(msg){
           toast.textContent = msg;
           toast.style.opacity = '1';
           toast.style.transform = 'translate(-50%,0)';
           setTimeout(function(){
             toast.style.opacity = '0';
             toast.style.transform = 'translate(-50%,8px)';
           }, 2400);
         }
         btn.addEventListener('click', function(ev){
           // Copy the activity URL to clipboard FIRST so the user
           // always gets the link even when no mail handler is
           // configured (common case on desktop where Gmail is just
           // a tab. Mailto: silently does nothing).
           var url = btn.getAttribute('data-activity-url') || '';
           if (url && navigator.clipboard && navigator.clipboard.writeText) {
             try {
               navigator.clipboard.writeText(url).then(function(){
                 showToast('Link copied. Paste into your email app.');
               }).catch(function(){
                 showToast('Tap-and-hold the link to copy.');
               });
             } catch (e) {
               showToast('Tap-and-hold the link to copy.');
             }
           }
           // Don't preventDefault. Let the mailto: still fire for
           // users who DO have a mail handler. They'll get both: the
           // compose window opens AND the URL is in their clipboard.
         });
       })();</script>
       ${relatedBlock}
       ${socialProof}
       ${dataBlock}
     </div>
     <a href="${e(iosUrl)}" class="floating-cta" id="floating-cta" data-default-label="Open in app">
       <span class="floating-cta-emoji">🐇</span>
       <span class="floating-cta-label">Open in app</span>
     </a>`;
}

function clip(s, n) {
  if (!s) return '';
  const collapsed = s.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= n) return collapsed;
  const slice = collapsed.slice(0, n - 1);
  const sp = slice.lastIndexOf(' ');
  const cut = sp > n - 20 ? slice.slice(0, sp) : slice;
  return cut + '…';
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
