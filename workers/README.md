# Bunny Path — Activity OG Worker

Cloudflare Worker that injects per-activity Open Graph tags into responses
for `bunnypath.com/a/{id}` so iMessage / WhatsApp / Twitter / Slack /
Facebook generate rich previews with the actual activity title and
description, instead of the generic OG block baked into `404.html`.

The Worker runs **only** on `/a/*`. Every other path on the site
(`/`, `/legal/...`, `/.well-known/...`, `/ref/...`, the 6-char referral
codes, the 404 fallback, all assets) is passed straight through to the
GitHub Pages origin and is unaffected.

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
