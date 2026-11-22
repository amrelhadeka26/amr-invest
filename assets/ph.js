/* PostHog product analytics for invest.amrelhadeka.com (added 2026-11-23).
   Privacy: cookieless mode (no cookies, no local or session storage; PostHog counts visitors with a daily-rotating
   server-side hash), no session recordings, no surveys or feature flags, Do Not Track / Global Privacy Control respected.
   Autocapture only records clicks on links, buttons, forms and selects; typed values are never captured.
   The project key below is a public client key by design (it ships in every page). */
(function () {
  try {
    if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;
    if (/^\/(hq|plan)(\/|$)/.test(location.pathname)) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://us-assets.i.posthog.com/static/array.js';
    s.onload = function () {
      if (!window.posthog || !window.posthog.init) return;
      window.posthog.init('phc_rdGR9kY9W53VY8jAot9JxDF2uPae3ZfqDmmNijEMYixP', {
        api_host: 'https://us.i.posthog.com',
        defaults: '2026-05-30',
        cookieless_mode: 'always',
        persistence: 'memory',
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_feature_flags: true,
        respect_dnt: true,
        person_profiles: 'identified_only',
        capture_dead_clicks: false,
        autocapture: { element_allowlist: ['a', 'button', 'form', 'select'] }
      });
    };
    document.head.appendChild(s);
  } catch (e) {}
})();
