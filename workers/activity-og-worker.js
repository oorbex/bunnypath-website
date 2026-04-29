/**
 * Bunny Path — per-activity Open Graph Worker.
 *
 * Route: bunnypath.com/a/*
 *
 * Why this exists: GitHub Pages only serves static HTML, and crawlers
 * (iMessage / WhatsApp / Slack / Twitter / Facebook) don't run JS. So a
 * client-side fetch in 404.html can't populate <meta property="og:*">.
 * This Worker sits in front of `/a/{id}` requests, fetches the activity
 * row from Supabase, and rewrites the <head> of the existing 404.html
 * shell so the response carries the activity-specific OG tags.
 *
 * Everything outside `/a/{uuid}` is passed straight through to the
 * GitHub Pages origin — index, legal pages, AASA, assets, /ref/, /{6}/,
 * etc. all keep working unchanged.
 */

const SUPABASE_URL = 'https://ffffbbmzuwcpwuhodpvb.supabase.co';
const SITE_ORIGIN = 'https://bunnypath.com';
// 512×512 ~256 KB — the full Bunny Path wordmark (same artwork as the
// homepage nav and `assets/logo.png`), downscaled and saved separately
// as `og-image.png` so social-preview clients fetch a small file fast.
// The 1024×1024 source `logo.png` is 1.6 MB which WhatsApp / Twitter
// often skip; the favicon-512 was the wrong artwork (simplified mark,
// no wordmark) so previews didn't match the homepage brand.
const OG_IMAGE = 'https://bunnypath.com/assets/og-image.png';
const ACTIVITY_PATH_RE = /^\/a\/([A-Za-z0-9-]+)\/?$/;
// 6-char base32-style referral codes — same alphabet the Flutter app uses
// (excludes 0/O, 1/l/I, U for human-readability). Lives at the root path.
const REFERRAL_PATH_RE = /^\/([abcdefghjkmnpqrstvwxyz23456789]{6})\/?$/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── Activity-share link: /a/{id}[?r={ref}] ────────────────────────
    const activityMatch = url.pathname.match(ACTIVITY_PATH_RE);
    if (activityMatch) {
      return handleActivity(request, activityMatch[1], url, env);
    }

    // ── Referral link: /{6-char-code} ─────────────────────────────────
    // Origin returns 404 for these (they're soft-routed by 404.html's
    // client-side JS). Most unfurlers (WhatsApp, Slack, iMessage) skip
    // OG fetching when the response is a 4XX — so we override status to
    // 200 and inject referral-specific OG tags so previews actually
    // render.
    const referralMatch = url.pathname.match(REFERRAL_PATH_RE);
    if (referralMatch) {
      return handleReferral(request, referralMatch[1].toLowerCase());
    }

    // Everything else (homepage, /legal/*, /assets/*, /.well-known/*,
    // etc.) is a pure passthrough.
    return fetch(request);
  },
};

async function handleActivity(request, activityId, url, env) {
  const refCode = url.searchParams.get('r') || '';

  // Look up the activity. RLS on `activities` is public-read (same as
  // the Flutter app), so the anon key is sufficient.
  const activity = await fetchActivity(activityId, env.SUPABASE_ANON_KEY);

  // If we couldn't find or load the activity, fall through to the
  // origin's 404.html — its client-side JS will render its generic
  // activity card and link to the App Store with attribution preserved.
  if (!activity) {
    return fetch(request);
  }

  // Pull the origin shell. We re-fetch the same URL so GitHub Pages's
  // 404 fallback delivers 404.html — that's the page the client-side
  // router already renders for /a/{id}.
  const originResponse = await fetch(request);
  const canonicalUrl = buildCanonicalUrl(activityId, refCode);
  const meta = buildMeta(activity, canonicalUrl);

  const rewritten = new HTMLRewriter()
    .on('head title', { element(el) { el.remove(); } })
    .on('head meta[name="description"]', { element(el) { el.remove(); } })
    .on('head meta[property^="og:"]', { element(el) { el.remove(); } })
    .on('head meta[name^="twitter:"]', { element(el) { el.remove(); } })
    .on('head meta[name="robots"]', { element(el) { el.remove(); } })
    .on('head', { element(el) { el.append(meta, { html: true }); } })
    .transform(originResponse);

  const headers = new Headers(rewritten.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'public, max-age=300, s-maxage=300');
  headers.set('x-bunnypath-og', 'rendered');

  return new Response(rewritten.body, { status: 200, headers });
}

async function handleReferral(request, code) {
  const upperCode = code.toUpperCase();
  const originResponse = await fetch(request);

  // Build the referral-specific OG block. Different copy from the
  // activity flow — this is "you've been invited" framing.
  const meta = `\n` +
    `<title>You're invited to Bunny Path</title>\n` +
    `<meta name="description" content="Get a free week of Premium with code ${upperCode}. 20,000+ off-screen play ideas for kids 0-12.">\n` +
    `<meta property="og:type" content="website">\n` +
    `<meta property="og:url" content="${SITE_ORIGIN}/${code}">\n` +
    `<meta property="og:site_name" content="Bunny Path">\n` +
    `<meta property="og:title" content="You're invited to Bunny Path">\n` +
    `<meta property="og:description" content="Get a free week of Premium with code ${upperCode}. 20,000+ off-screen play ideas for kids 0-12.">\n` +
    `<meta property="og:image" content="${OG_IMAGE}">\n` +
    `<meta property="og:image:width" content="512">\n` +
    `<meta property="og:image:height" content="512">\n` +
    `<meta property="og:image:alt" content="Bunny Path">\n` +
    `<meta name="twitter:card" content="summary_large_image">\n` +
    `<meta name="twitter:title" content="You're invited to Bunny Path">\n` +
    `<meta name="twitter:description" content="Get a free week of Premium with code ${upperCode}. 20,000+ off-screen play ideas for kids 0-12.">\n` +
    `<meta name="twitter:image" content="${OG_IMAGE}">\n`;

  const rewritten = new HTMLRewriter()
    .on('head title', { element(el) { el.remove(); } })
    .on('head meta[name="description"]', { element(el) { el.remove(); } })
    .on('head meta[property^="og:"]', { element(el) { el.remove(); } })
    .on('head meta[name^="twitter:"]', { element(el) { el.remove(); } })
    // Strip the "noindex" robots tag — it's appropriate for the generic
    // 404.html fallback case but we DO want crawlers to render the
    // referral preview when this URL shape resolves.
    .on('head meta[name="robots"]', { element(el) { el.remove(); } })
    .on('head', { element(el) { el.append(meta, { html: true }); } })
    .transform(originResponse);

  const headers = new Headers(rewritten.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'public, max-age=300, s-maxage=300');
  headers.set('x-bunnypath-og', 'rendered-referral');

  // Status override: GitHub Pages returns 404 for /{code} but we want
  // unfurlers to see 200 so they actually generate a preview.
  return new Response(rewritten.body, { status: 200, headers });
}

async function fetchActivity(id, anonKey) {
  if (!anonKey) return null;
  // Accept BOTH 36-char UUIDs (legacy share URLs) and 5-char base32
  // short_ids (migration 026). Reject anything else so we don't pass
  // garbage through to PostgREST.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const isShortId = /^[abcdefghjkmnpqrstvwxyz23456789]{5}$/i.test(id);
  if (!isUuid && !isShortId) return null;

  const lookupKey = isUuid ? 'id' : 'short_id';
  const lookupValue = isUuid ? id : id.toLowerCase();
  const endpoint = `${SUPABASE_URL}/rest/v1/activities?${lookupKey}=eq.${encodeURIComponent(lookupValue)}&select=title,description,type,time,age_range,age_bracket`;
  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        accept: 'application/json',
      },
      // Edge cache the upstream fetch — Workers fetch participates in
      // Cloudflare's cache when given a cf.cacheTtl hint.
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

function buildCanonicalUrl(id, refCode) {
  const base = `${SITE_ORIGIN}/a/${id}`;
  return refCode ? `${base}?r=${encodeURIComponent(refCode)}` : base;
}

function buildMeta(activity, canonicalUrl) {
  const rawTitle = (activity.title || 'Activity').toString();
  const rawDescription = (activity.description || '').toString();
  const title = `${rawTitle} — Bunny Path`;
  const shortDesc = clip(rawDescription, 150) || 'A hand-crafted, off-screen play idea on Bunny Path.';
  const ogDesc = clip(rawDescription, 200) || 'A hand-crafted, off-screen play idea on Bunny Path.';

  const t = htmlEscape(title);
  const d150 = htmlEscape(shortDesc);
  const d200 = htmlEscape(ogDesc);
  const u = htmlEscape(canonicalUrl);

  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d150}">`,
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

function clip(s, n) {
  if (!s) return '';
  const collapsed = s.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= n) return collapsed;
  // Trim on a word boundary if we can find one in the last 20 chars.
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
