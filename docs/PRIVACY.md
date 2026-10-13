---
sidebarDepth: 0
---

# Privacy

This page describes what the Coffilot documentation site collects, and how to change your mind at any time.

## The Coffilot extension sends no analytics

Coffilot itself is a local-only GitHub Copilot canvas extension. It binds to `127.0.0.1`, runs your own build tool, and
never sends usage telemetry or analytics to Coffilot or an analytics provider. The analytics consent controls below
apply only to this documentation website, not to the extension.

## Analytics on this website

This website can use Google Analytics 4 (measurement ID `G-92TRR0HJMQ`) to count page views and understand which
documentation pages are actually read.

- **Nothing is loaded until you accept.** The Google Analytics script is not requested, and no analytics cookie is
  written, unless you choose "Accept" in the banner. Declining, or ignoring the banner, causes no analytics requests.
- **What is stored if you accept:** Google Analytics sets the `_ga` and `_ga_*` cookies, which hold a randomly
  generated identifier used to recognise a returning browser. Google receives your IP address, page URL, referrer,
  and basic device and browser information as the data processor for these measurements.
- **Legal basis:** your consent, under Article 6(1)(a) GDPR and the ePrivacy Directive. You can withdraw it at any
  time using the controls below.

Your answer to the banner is remembered in your browser's `localStorage` under `coffilot-analytics-consent`. That entry
is strictly necessary to honour your choice, is never sent anywhere, and is not used to identify you. If your browser
refuses that storage, your answer is kept in memory for the current visit only.

## Change your choice

<CookieSettings />

Refusing here also deletes any Google Analytics cookies already present in this browser and stops further measurement
immediately. You can additionally install Google's [opt-out browser add-on](https://tools.google.com/dlpage/gaoptout).

## Hosting and contact

The site is served as static files from GitHub Pages. For any privacy request, open an issue on the
[Coffilot repository](https://github.com/jdubois/coffilot/issues) or contact the maintainer through
[julien-dubois.com](https://www.julien-dubois.com).
