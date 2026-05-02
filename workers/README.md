# Bunny Path — Activity OG + Rich-Landing Worker

Cloudflare Worker that does two things on `bunnypath.com`:

1. **Per-activity OG tags** for `/a/{id}` so iMessage / WhatsApp /
   Twitter / Slack / Facebook generate rich previews with the actual
   activity title and description (not the generic OG block in
   `404.html`).
2. **Server-renders the rich activity-share landing card** — sender
   attribution bar, full description, materials list, first 2 steps
   visible / rest blurred behind a specific gate, benefits, related
   activities, social-proof strip, smart-app-banner, floating "Open in
   app" CTA, age-cohort prompt, and SMS / mailto fallbacks. Pre-rendered
   server-side so search engines / unfurlers see the full page and the
   user gets no hydration flash.

The Worker is configured for the catch-all route `bunnypath.com/*` and
dispatches by path shape:

- `/a/{uuid|short_id}` — activity-share landing (rich, server-rendered)
- `/{6-char}` — referral landing (OG-only; body is still client-rendered)
- everything else — passthrough to GitHub Pages origin (unchanged)

---

## Files

- `activity-og-worker.js` — the Worker (single ES module, no deps)
- `wrangler.toml` — deploy config

---

## Prerequisites

- A Cloudflare account with the `bunnypath.com` zone already added
  (already true — DNS is on Cloudflare per `cloudflare-dns-import.txt`).
- Node 18+ and the `wrangler` CLI:

  ```bash
  npm install -g wrangler
  ```

---

## One-time setup

From this `workers/` directory:

```bash
# 1. Authenticate (opens browser)
wrangler login

# 2. Upload the Supabase anon key as a Worker secret. The Worker reads it
#    from env.SUPABASE_ANON_KEY at runtime; it is NEVER stored in source.
#    (Anon key is the same one used by the Flutter app —
#     bunnypath_app/lib/core/config/supabase_config.dart.)
wrangler secret put SUPABASE_ANON_KEY
# When prompted, paste:
#   sb_publishable_yu_WSkvV-p5vnb1mqAbR6g_H5x3FFCK
```

## Sender personalization (SOTA pattern)

The "Sarah shared this with you" line on the activity-share landing
needs to read `profiles.name` keyed on `referral_code`. The `profiles`
table has owner-only RLS, so the anon key alone returns `[]`.

Rather than giving the Worker a service-role key (which would bypass
ALL RLS on every table — a critical-finding security misconfiguration
for an internet-facing edge function), the Worker calls a narrowly-
scoped Postgres RPC: `public.get_referrer_first_name(p_code text)`,
created by migration 027.

The RPC uses `SECURITY DEFINER` to read past `profiles` RLS *internally*
but exposes only the first whitespace-token of `name` (e.g. "Sarah Smith"
→ "Sarah"). Even if the Worker is compromised, the blast radius is one
first name per known referral code — not the entire DB.

No additional Cloudflare secrets needed. The Worker uses the same anon
key it already has for activity lookups.

---

## Deploy

```bash
wrangler deploy
```

That uploads the Worker as `bunnypath-activity-og`. It is not yet bound
to any traffic — you have to attach it to a route.

---

## Configure the route

Cloudflare dashboard → **Workers & Pages** → `bunnypath-activity-og` →
**Settings** → **Triggers** → **Routes** → **Add route**:

- **Pattern:** `bunnypath.com/a/*`
- **Zone:** `bunnypath.com`

Save. Within a few seconds, requests to `bunnypath.com/a/...` start
hitting the Worker. Everything else still goes to GitHub Pages.

---

## Verify

After the route is live, run these against the production hostname:

```bash
# Pick any real activity id from Supabase; replace <id> below.

# 1. The Worker should inject activity-specific OG tags.
curl -sA "WhatsApp/2.24" "https://bunnypath.com/a/<id>" \
  | grep -E '<title>|og:title|og:description|og:image|twitter:'

# Expected: <title> and og:title contain the activity's actual title
# (followed by " — Bunny Path"), og:description contains a clipped excerpt
# of the activity's description, og:image points at /assets/logo.png.
# Response also has the header `x-bunnypath-og: rendered`.

curl -sI "https://bunnypath.com/a/<id>" | grep -i x-bunnypath-og

# 2. Non-/a/ paths should pass through untouched (no x-bunnypath-og header).
curl -sI "https://bunnypath.com/legal/privacy/" | grep -i x-bunnypath-og || echo "passthrough OK"
curl -sI "https://bunnypath.com/" | grep -i x-bunnypath-og || echo "passthrough OK"

# 3. Unknown / malformed activity ids fall back to the static 404.html
#    (its client-side JS still renders the generic activity-share card).
curl -sA "WhatsApp/2.24" "https://bunnypath.com/a/not-a-real-id" \
  | grep -E '<title>|og:title' | head -5
```

You can also paste a `https://bunnypath.com/a/<id>` URL into:

- **iMessage** (preview shows actual activity title + brand mark)
- **Slack** (`/unfurl` or just paste in any channel)
- **Twitter / X**: https://cards-dev.twitter.com/validator
- **Facebook**: https://developers.facebook.com/tools/debug/
- **LinkedIn**: https://www.linkedin.com/post-inspector/

(Facebook and LinkedIn cache aggressively; use their "Scrape Again"
button to refresh after a Worker change.)

---

## Caching

Worker-rendered responses set `Cache-Control: public, max-age=300` and
the upstream Supabase fetch uses `cf.cacheTtl: 300`. That's a 5-minute
edge cache per `(activity id)` — long enough to absorb a viral share
without pounding Supabase, short enough that an activity title fix shows
up within minutes. Bump these higher (e.g. 3600) if you want more
aggressive caching once you've confirmed activity content is stable.

---

## Rollback

If the Worker ever misbehaves, removing the `bunnypath.com/a/*` route in
the dashboard restores the previous behavior (GitHub Pages → 404.html
client-side router) immediately. The fallback static OG tags now in
`404.html` are a sensible "Bunny Path — Play Ideas for Kids" block, so
share previews stay generically correct even with the Worker disabled.

---

## Universal Links / Digital Asset Links (AASA + assetlinks.json)

GitHub Pages serves `/.well-known/apple-app-site-association` as
`text/plain`, which silently breaks iOS Universal Links. Same story for
Android's `/.well-known/assetlinks.json`. Because this Worker sits on
the catch-all `bunnypath.com/*` route, it intercepts both well-known
paths, fetches the static file from origin, and rewrites the response
with `Content-Type: application/json` + `Cache-Control: public,
max-age=3600`.

To verify after deploy:

```bash
curl -sI "https://bunnypath.com/.well-known/apple-app-site-association" \
  | grep -i content-type
# Expected: content-type: application/json

curl -sI "https://bunnypath.com/.well-known/assetlinks.json" \
  | grep -i content-type
# Expected: content-type: application/json
```

---

## Security headers

Every successful Worker response carries the following headers (the
passthrough path layers them on too, so the marketing site's static
HTML / assets are covered uniformly):

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://unpkg.com; font-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none'`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

CSP notes:

- `img-src 'self' data: https:` lets the worker-rendered cards show
  Apple/Google store badges and Supabase-hosted activity images
  without per-domain allowlisting.
- `style-src 'unsafe-inline'` is required because the worker inlines
  the critical-CSS block in `<head>` for first-paint, and the
  marketing site itself has inline `<style>` blocks. If/when you move
  that to an external stylesheet you can drop the `'unsafe-inline'`.
- `script-src 'self' 'unsafe-inline' https://unpkg.com` covers
  `index.html`'s inline init scripts and the `lucide` icon CDN
  (`<script src="https://unpkg.com/lucide@...">`). Tightening to
  `'self'` would break the homepage; revisit once those move
  in-tree.

To verify:

```bash
curl -sI "https://bunnypath.com/" | grep -iE 'strict-transport|content-security|referrer-policy|x-content-type|permissions-policy'
```

---

## App Store review monitor (separate Worker)

`app-review-monitor.js` is a second, independent Worker that polls
Apple's iTunes RSS reviews feed for app id `6761960397` once an hour,
dedupes against a Cloudflare KV namespace, and (optionally) fans new
reviews out to a webhook URL stored as a secret. See
`wrangler-app-review-monitor.toml` for the cron + KV binding.

Cross-reference: production-readiness plan §B16 / §6 Q7
(build vs. Appfigures).

Owner action items:

```bash
# 1. Create the KV namespace and copy the returned `id` into
#    wrangler-app-review-monitor.toml under [[kv_namespaces]].
wrangler kv:namespace create app-review-state

# 2. (Optional) Configure a webhook URL. If unset, the Worker just
#    console.log's new reviews — you can read them with `wrangler tail`.
wrangler secret put REVIEW_WEBHOOK_URL --config wrangler-app-review-monitor.toml

# 3. Deploy the Worker. The cron trigger declared in the toml will start
#    firing on the hour; you can also hit /run on the Worker URL to
#    trigger a poll manually for debugging.
wrangler deploy --config wrangler-app-review-monitor.toml

# 4. Tail logs to confirm the first run.
wrangler tail bunnypath-app-review-monitor
```

The Worker's behavior:

- Fetches `https://itunes.apple.com/us/rss/customerreviews/id=6761960397/sortBy=mostRecent/json`
- For each entry with an id not in `KV[seen-review-ids]`, treats it as
  new: posts to the webhook (if configured) and logs it via
  `console.log`.
- Stores the most recent 200 review ids in KV so old entries that
  briefly drop out of the feed don't re-fire.
- A non-`/run` HTTP request returns 404; cron is the primary entry
  point. `/run` is provided for manual debugging only.

