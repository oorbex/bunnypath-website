/* ─────────────────────────────────────────────────────────────────────────
   Bunny Path marketing-site analytics (2026-08).

   Why this file exists
   ────────────────────
   bunnypath.com is the primary acquisition channel and its only conversion
   action is the coral "Start free" button pointing at app.bunnypath.com.
   Until now the site carried NO analytics of any kind, so the entire
   pre-click half of the funnel was invisible: we could see signups in the
   app but never how many people saw the page, which CTA slot they clicked,
   or how big the drop-off between the two was.

   This loads PostHog with the SAME project key the Flutter app uses
   (bunnypath_app/lib/core/config/posthog_config.dart). Same project =
   one continuous funnel: marketing pageview -> app_cta_click -> in-app
   signup, all queryable in a single PostHog insight. If that key ever
   rotates, both files have to change together.

   Privacy posture (this is a children's product)
   ─────────────────────────────────────────────
   - autocapture: false        -> no blanket DOM-event harvesting. Only the
                                  explicit events below are ever sent.
   - disable_session_recording -> no session replay, ever.
   - capture_heatmaps: false   -> no click-coordinate collection.
   - person_profiles:
       'identified_only'       -> anonymous visitors never get a person
                                  profile; a profile only exists once the
                                  app itself calls identify() after signup.
   - respect_dnt: true         -> Do Not Track browsers are not tracked.
   - sanitize_properties       -> strips the URL fragment off every event.
                                  Non-negotiable: Supabase's implicit auth
                                  flow lands on the homepage with
                                  `#access_token=...` in the URL, and the
                                  fragment router in index.html redirects
                                  from there. A raw $current_url would ship
                                  a live access token to a third party.

   NOT loaded on /auth/* pages. Those exist only to consume that
   access-token fragment; the safest handling of a page whose URL is a
   credential is to not instrument it at all.
   ───────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // Project key mirrors PostHogConfig.apiKey in the Flutter app. A write-only
  // ingestion key; public by design (it is in every app binary already).
  var PH_KEY = 'phc_vEovTPz4D8NcwWX6AkPFWNrdJKPLPZ9AMp5QM2SUYFRn';
  var PH_HOST = 'https://us.i.posthog.com';

  // ── PostHog loader snippet (official js-web install, unmodified) ────────
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  /** Drop the URL fragment from any URL-shaped property. See header note. */
  function stripFragment(v) {
    return (typeof v === 'string' && v.indexOf('#') !== -1)
      ? v.slice(0, v.indexOf('#'))
      : v;
  }

  posthog.init(PH_KEY, {
    api_host: PH_HOST,
    // Explicit rather than inherited from a `defaults` bundle: these values
    // are a privacy commitment, and a future posthog-js default flip must
    // not silently turn autocapture or replay back on.
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: true,
    capture_heatmaps: false,
    disable_session_recording: true,
    disable_surveys: true,
    person_profiles: 'identified_only',
    respect_dnt: true,
    sanitize_properties: function (props) {
      if (!props) return props;
      ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer']
        .forEach(function (k) {
          if (props[k]) props[k] = stripFragment(props[k]);
        });
      return props;
    },
  });

  // ── CTA instrumentation ────────────────────────────────────────────────
  // Every app link on the site already carries `data-app-cta` and a
  // `data-cta-slot` (nav / hero / footer / gate) for the UTM stamper. We
  // reuse the exact same attributes here, so the slot that PostHog reports
  // and the `utm_content` that lands on app.bunnypath.com are guaranteed to
  // agree -- one source of truth, no second list of selectors to keep in
  // sync when a CTA moves.
  //
  // Delegated on document so it works no matter when the CTA enters the DOM
  // and no matter that bpStamp()/the UTM stamper rewrites hrefs first: we
  // read a.href at click time, i.e. the final stamped destination.
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest && ev.target.closest('a[data-app-cta]');
    if (!a) return;
    var slot = a.getAttribute('data-cta-slot') || 'cta';
    var props = {
      slot: slot,
      href: stripFragment(a.href || ''),
      label: (a.textContent || '').trim().slice(0, 60),
      page: location.pathname,
    };
    try {
      // One canonical event for funnel math across every slot...
      posthog.capture('app_cta_click', props);
      // ...plus the named hero event, which is the single number that says
      // whether the page's primary above-the-fold promise is working.
      if (slot === 'hero') posthog.capture('hero_cta_click', props);
    } catch (e) { /* analytics must never break a click-through */ }
  }, true);
})();
