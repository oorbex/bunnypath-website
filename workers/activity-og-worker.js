/**
 * Bunny Path — per-activity Open Graph + rich landing-page Worker.
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
 * straight through to the GitHub Pages origin — index, legal pages,
 * AASA, assets, etc. all keep working unchanged.
 */

const SUPABASE_URL = 'https://ffffbbmzuwcpwuhodpvb.supabase.co';
const SITE_ORIGIN = 'https://bunnypath.com';
const APP_STORE_ID = '6761960397';
const ANDROID_BUNDLE = 'com.kodsters.bunnypath';
// 512×512 ~256 KB — the full Bunny Path wordmark (same artwork as the
// homepage nav and `assets/logo.png`), downscaled and saved separately
// as `og-image.png` so social-preview clients fetch a small file fast.
const OG_IMAGE = 'https://bunnypath.com/assets/og-image.png';
const ACTIVITY_PATH_RE = /^\/a\/([A-Za-z0-9-]+)\/?$/;
// 6-char base32-style referral codes — same alphabet the Flutter app uses
// (excludes 0/O, 1/l/I, U for human-readability). Lives at the root path.
const REFERRAL_PATH_RE = /^\/([abcdefghjkmnpqrstvwxyz23456789]{6})\/?$/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const activityMatch = url.pathname.match(ACTIVITY_PATH_RE);
    if (activityMatch) {
      return handleActivity(request, activityMatch[1], url, env);
    }

    const referralMatch = url.pathname.match(REFERRAL_PATH_RE);
    if (referralMatch) {
      return handleReferral(request, referralMatch[1].toLowerCase());
    }

    return fetch(request);
  },
};

async function handleActivity(request, activityId, url, env) {
  const refCode = (url.searchParams.get('r') || '').trim();
  const anonKey = env.SUPABASE_ANON_KEY;

  const activity = await fetchActivity(activityId, anonKey);
  if (!activity) {
    // Couldn't find / load — fall through to the origin's 404.html.
    // Its client-side JS still renders a generic activity card.
    return fetch(request);
  }

  // Parallel: sender name (optional, gated on ?r=) + 3 related activities.
  // Sender name comes from the SECURITY DEFINER RPC `get_referrer_first_name`
  // (migration 027) — narrowly-scoped, callable with the anon key, returns
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

  return new Response(rewritten.body, { status: 200, headers });
}

async function handleReferral(request, code) {
  const upperCode = code.toUpperCase();
  const originResponse = await fetch(request);

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
    .on('head meta[name="robots"]', { element(el) { el.remove(); } })
    .on('head', { element(el) { el.append(meta, { html: true }); } })
    .transform(originResponse);

  const headers = new Headers(rewritten.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'public, max-age=300, s-maxage=300');
  headers.set('x-bunnypath-og', 'rendered-referral');

  return new Response(rewritten.body, { status: 200, headers });
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

async function fetchSenderName(refCode, anonKey) {
  if (!refCode || !anonKey) return null;
  // Defense: reject anything that doesn't fit the 6-char base32 referral
  // shape before we send it to the DB. The RPC also filters internally
  // (it uses upper(trim(?))) but cheap to enforce here too.
  if (!/^[abcdefghjkmnpqrstvwxyz23456789]{6}$/i.test(refCode)) return null;
  // Sender attribution goes through `public.get_referrer_first_name`, a
  // SECURITY DEFINER RPC created by migration 027. The function reads
  // past `profiles` RLS *internally* but only returns the first
  // whitespace-token of `name` (e.g. "Sarah Smith" → "Sarah") or null.
  // Callable by anon — no service-role key needed, blast radius is one
  // first name per known referral code even if the Worker is compromised.
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
        cf: { cacheTtl: 300 },  // 5-min edge cache, same as activity lookup
      },
    );
    if (!res.ok) return null;
    const result = await res.json();
    if (typeof result !== 'string') return null;
    const trimmed = result.trim();
    return trimmed === '' ? null : trimmed;
  } catch (_) {
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
  const title = `${rawTitle} — Bunny Path`;
  const shortDesc = clip(rawDescription, 150) || 'A hand-crafted, off-screen play idea on Bunny Path.';
  const ogDesc = clip(rawDescription, 200) || 'A hand-crafted, off-screen play idea on Bunny Path.';

  const t = htmlEscape(title);
  const d150 = htmlEscape(shortDesc);
  const d200 = htmlEscape(ogDesc);
  const u = htmlEscape(canonicalUrl);

  // Smart App Banner — iOS Safari one-tap install. `app-argument` carries
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

// Type-emoji map — types are constrained to these three strings (see CLAUDE.md).
const TYPE_EMOJI = {
  'Active play': '🏃',
  'Discovery': '🔍',
  'Creative': '🎨',
};

function typeEmoji(type) {
  return TYPE_EMOJI[type] || '✨';
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
  const totalSteps = steps.length;
  const visibleSteps = steps.slice(0, 2);
  const blurredSteps = steps.slice(2);

  // ── Sender attribution (Section 1) ───────────────────────────────────
  // Only render when both ?r= and a real name lookup succeeded. Anything
  // less is silently dropped — never a generic "Someone shared this".
  const senderBar = senderName
    ? `<div class="sender-bar"><strong>${e(senderName)}</strong> shared this with you 🐇</div>`
    : '';

  // ── Hero (Section 2) ─────────────────────────────────────────────────
  const pills = [];
  if (type) pills.push(`<span class="activity-meta-pill">${typeEmoji(type)} ${e(type)}</span>`);
  if (time) pills.push(`<span class="activity-meta-pill">⏱ ${e(time)}</span>`);
  if (ageRange) pills.push(`<span class="activity-meta-pill">👶 Ages ${e(ageRange)}</span>`);

  // ── Description (Section 3) — full, no truncation ───────────────────
  const descBlock = description
    ? `<p class="activity-description">${e(description)}</p>`
    : '';

  // ── Materials (Section 4) ───────────────────────────────────────────
  const materialsBlock = materials.length
    ? `<div class="activity-section">
         <h2 class="activity-section-h">You'll need</h2>
         <ul class="bullet-list">
           ${materials.map((m) => `<li>${e(String(m))}</li>`).join('')}
         </ul>
       </div>`
    : '';

  // ── Steps (Section 5) — first 2 clear, rest blurred + locked ────────
  let stepsBlock = '';
  if (steps.length) {
    const visibleHtml = visibleSteps
      .map((s, i) => `<li><span class="step-num">${i + 1}</span><span>${e(String(s))}</span></li>`)
      .join('');
    const blurredHtml = blurredSteps.length
      ? blurredSteps
          .map((s, i) => `<li class="step-locked"><span class="step-num">${i + 3}</span><span>${e(String(s))}</span></li>`)
          .join('')
      : '';
    // Specific gate text per Andrew Chen — name the count, the missing
    // pieces by category, and the cohort.
    const gateAge = ageRange ? `ages ${e(ageRange)}` : 'this age range';
    const gateText = blurredSteps.length
      ? `Open the app to see all ${totalSteps} steps + similar activities for ${gateAge}`
      : `Open the app to see materials, similar activities for ${gateAge}, and more`;
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
  const benefitsBlock = benefits.length
    ? `<div class="activity-section">
         <h2 class="activity-section-h">What kids gain</h2>
         <ul class="bullet-list bullet-list-sparkle">
           ${benefits.slice(0, 6).map((b) => `<li>${e(String(b))}</li>`).join('')}
         </ul>
       </div>`
    : '';

  // ── Cohort prompt (Play B) — between benefits and CTAs ──────────────
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
         <h2 class="activity-section-h">More for ages ${e(ageRange || '')}</h2>
         <div class="related-grid">
           ${related.map((r) => {
              const rsid = e(r.short_id || r.id);
              const rurl = `/a/${rsid}${refCode ? `?r=${encodeURIComponent(refCode)}` : ''}`;
              return `<a class="related-card" href="${e(rurl)}">
                <span class="related-emoji">${typeEmoji(r.type)}</span>
                <span class="related-title">${e(r.title || '')}</span>
                ${r.type ? `<span class="related-pill">${e(r.type)}</span>` : ''}
              </a>`;
           }).join('')}
         </div>
       </div>`
    : '';

  // ── Below-the-fold social proof (Section 10) ────────────────────────
  const socialProof = `
       <div class="social-proof-strip">
         <p><strong>16,000+ activities curated by parents and child-development specialists.</strong></p>
         <p>Off-screen, educational, guilt-free. Built by parents like you 🧡</p>
       </div>`;

  // ── CTA row (Play C) — iPhone / Android / Text me ───────────────────
  // Final href values get wired client-side based on userAgent (iOS vs
  // Android), so SSR ships sane defaults; the JS upgrades them.
  const smsBody = `Bunny Path app — ${SITE_ORIGIN}/a/${sid}${refCode ? `?r=${refCode}` : ''}`;
  const mailBody = `Try this activity: ${SITE_ORIGIN}/a/${sid}${refCode ? `?r=${refCode}` : ''}`;
  const smsHref = `sms:?body=${encodeURIComponent(smsBody)}`;
  const mailHref = `mailto:?subject=${encodeURIComponent('Bunny Path')}&body=${encodeURIComponent(mailBody)}`;

  // Pre-build store URLs server-side so even no-JS fallback works.
  const campaignToken = `ACT_${activityId}${refCode ? `_REF_${refCode}` : ''}`;
  const iosUrl = `https://apps.apple.com/app/id${APP_STORE_ID}?mt=8&ct=${encodeURIComponent(campaignToken)}`;
  const androidReferrer = `activity=${activityId}${refCode ? `&ref=${refCode}` : ''}`;
  const androidUrl = `https://play.google.com/store/apps/details?id=${ANDROID_BUNDLE}&referrer=${encodeURIComponent(androidReferrer)}`;

  // Card data — read by the page-side JS (cohort prompt, floating CTA
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
       <a href="${e(mailHref)}" class="btn-tertiary-link" id="activity-mail-btn">Or email it to yourself</a>
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
