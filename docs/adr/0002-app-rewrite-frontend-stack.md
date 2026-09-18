# ADR 0002: The libraries the rewritten web app is built from

- **Status:** accepted on 2026-09-18. The choices below are what `webapp/` is scaffolded on; the screens are not
  drawn yet and nothing here depends on how they look.
- **Date:** 2026-09-18
- **Touches:** `webapp/`
- **Builds on:** [ADR 0001](0001-app-rewrite-data-model.md), which fixes the model, the `/v1` API and the
  contract in `@fg2/shared-types/v1`.

## Context

The web app is rewritten from scratch in React against a decided set of screens. Three of that record's rules
reach every choice below: it is **mobile first**, desktop second, tablet third; it is one design for everyone,
with no persona or mode selection; and **every value carries an age** and is dimmed rather than hidden when it is
old. Two more come from outside the screens: the app must be **installable as a progressive web app**, because a
native store build may follow, and it **consumes the contract's types directly**, so no shape is written down
twice. The look is "Instrument" in two modes, with a closed palette, IBM Plex Sans for text, JetBrains Mono for
every figure, 8 px corners, 1 px rules and no shadows.

A library is worth a dependency here when it does something the platform does not, and cheap enough that a phone
on a bad connection does not pay for it. That is the test each choice below had to pass.

## The choices

### Build tool and test runner: Vite, with Vitest

Vite builds the app and serves it while it is written; Vitest runs the tests. The app is a static bundle talking
to an API that already exists, so the obvious alternative, Next.js, would add a server runtime that nothing here
needs and that the nginx image in `docker-compose.yaml` has no place for — and a framework whose whole point is
rendering on the server is a strange base for something that also has to run from a home screen with no network.
Vitest shares Vite's config and transform, so the app is tested through the same pipeline that builds it rather
than through a second one that has to be kept in step.

### Routing: React Router

Routes are plain objects in `src/app/routes.tsx`, nested under one shell so the tab bar and the desktop rail are
rendered once and the screen changes below them. TanStack Router's typed routes are the better types, but the
data every screen needs is fetched by TanStack Query and not by the router, which leaves the routing itself
simple enough that the types are not what decides; React Router is also what a later Capacitor wrapper and every
piece of PWA advice assumes, and history and deep links behave the way that world expects.

### Server state: TanStack Query, and no store beside it

Everything the API answers is cached, refetched and invalidated by TanStack Query. It earns its place on the live
values: the home card refetches in the background, keeps showing the last reading while the next one is in
flight, and the age the server sends with each value stays truthful because nothing is hidden during a refetch.
Redux or Zustand would be a second home for the same data with hand-written loading flags; what is genuinely not
server state — the session and the theme — is small enough for a module-level store and a React context, so the
app carries no state library at all.

### Talking to the API: a small typed `fetch`, not a client library

`src/api/client.ts` attaches the bearer token, retries once behind a fresh one when the server answers 401, and
turns every failure into an `ApiError` carrying the `application/problem+json` document — `errors[]` keyed by
field, which is exactly what a form needs. That is about sixty lines and it ends there; axios would add a
dependency for retries and interceptors the platform's `fetch` and one wrapper already give, and a generated
client would restate the routes that the contract's types already describe.

The session is the part worth naming. `POST /v1/sessions` answers three tokens: a bearer token that lives five
minutes, a refresh token, and a media token that rides in the query string of a picture's URL because an `<img>`
cannot carry a header. `src/api/session.ts` holds them outside React, refreshes ahead of expiry with exactly one
request in flight however many callers are waiting, and persists only the refresh token — in `localStorage` when
"stay logged in" was ticked and in `sessionStorage` when it was not, which is what the flag on the request body
means. `mediaUrl(id)` is the single place that appends the media token, and it is the only place a token is ever
put in a URL.

### Forms: React Hook Form, validated by the server

Inputs stay uncontrolled, so typing in one field does not re-render a dense list around it — which is the
difference one notices on a phone, and the reason React Hook Form beats Formik or a page of `useState`. What it
is deliberately *not* paired with is a client-side copy of the contract's zod schemas: `@fg2/shared-types`
publishes the schema objects, but importing one pulls the whole registry and zod with it, and measuring it put
about 300 kB of source into the bundle for rules the server enforces again anyway. So the form checks only what
saves a pointless round trip, and what is actually valid comes back as `problem.errors[]` and is written onto the
fields. This is also what the contract intends: it offers flat interfaces *"with no dependency on zod, for a
client"*.

### Dates and durations: Luxon

Ages, day counters, week grids and phase lengths are all date arithmetic in a person's own time zone, which
`users.preferences.timezone` names and which is not the browser's. Luxon does zones and durations in one object
and is what the server already computes in, so the two agree about what "day 34" is; date-fns would be smaller
but pushes zone handling back onto the caller, and that is precisely the part worth not doing twice. What Luxon
is *not* used for is deciding whether a value is live, stale or offline — the server answers that with the value,
from one shared constant and its own clock, and `src/ui/age.ts` only puts the age into words.

### Internationalisation: i18next with react-i18next

The catalogues at `webapp/public/assets/i18n/{en,de}.json` are kept exactly as they are, and they decide this
choice: they interpolate `{{value}}`, which is i18next's default syntax and ngx-translate's before it, so both
files load unchanged. FormatJS or Lingui would mean ICU messages and rewriting every placeholder in two files of
a hundred sections, for a feature — plurals and genders chosen by the message — that these strings do not use.
Both catalogues are fetched at start-up rather than bundled, so a hundred kilobytes of text stays out of the
JavaScript, and the service worker precaches them so an offline reload still has words.

**The device's log messages keep resolving.** A device writes keys, not sentences, and the server parses a log
line into `message { key, params }` at the device-protocol boundary. The catalogue answers such a key two ways,
and `src/i18n/device-message.ts` tries them in order: first the wording written for that exact parameter,
`message-device-booted:BROWNOUT-text`, then the generic wording with the parameter interpolated,
`message-device-booted-text` with `{{value}}`. A key with neither is shown as it came, so a line a newer firmware
invents is readable before anybody translates it. Two settings make this work: `nsSeparator` is off, because
those keys contain colons that i18next would otherwise read as a namespace, and `en` is always loaded beside the
active language as the fallback. A test reads the shipped `en.json` and holds all three cases, so renaming a key
in the catalogue fails the build rather than emptying a diary entry.

### Charts: ECharts

Decided in the design record: ECharts, not Highcharts. Two reasons are worth repeating. It is Apache-2.0, like
this repository, where Highcharts is proprietary for commercial use; and it draws to a canvas, which is what
keeps a week of climate samples with night shading, a target band and an output lane scrolling on a phone where
an SVG chart of the same data would not. It is used through `echarts/core` with the pieces the screens actually
draw registered by hand in `src/charts/Chart.tsx`, so what is not drawn is not downloaded, and through a small
React binding of our own rather than a wrapper package — the binding is an effect, a `ResizeObserver` and a
`dispose`, and owning it is cheaper than tracking somebody else's version of it.

### Camera stills and video: nothing new

A still is an `<img>` pointed at `GET /v1/media/{id}/content` with the media token; a timelapse is a rendered MP4
served by the same route and played by the platform's `<video>`. There is no adaptive stream anywhere in this
system — the server pulls RTSP cameras and stores frames, and the composer renders a finished file — so hls.js,
video.js and Plyr would each be a large dependency for machinery nothing feeds. The day the API answers an HLS
playlist, hls.js is the one to add, and it is the only thing that would change.

### Styling: CSS custom properties, consumed through CSS Modules

The round-15 palette is a closed set of about twenty colours in two modes, and `src/theme/tokens.css` is the only
file any of them is written in. **A token reaches a component as a CSS variable**: `tokens.css` defines the
names on `:root`, redefines them under `@media (prefers-color-scheme: dark)` for a system that asks for dark and
has not been overruled and again under `:root[data-theme="dark"]` for the manual toggle, and a component's own
`.module.css` says `var(--card)` or `var(--temperature)`. Switching mode is therefore one attribute on `<html>`:
no provider, no re-render, nothing to keep in step. Tailwind would mean restating the same palette in a config
and would invite the literals back in as arbitrary values; a CSS-in-JS library would move colours into the
JavaScript bundle and make the theme a React concern, which it is not. The one place a variable cannot reach is
ECharts' canvas, so `src/charts/tokens.ts` reads the computed values off the document and hands them over —
still one source, read rather than duplicated.

Fonts are self-hosted through `@fontsource-variable`, weight axis only and latin subsets precached. Google Fonts
would be a third-party request on every load, which an installed app cannot rely on and which tells somebody else
who opened the app.

### Icons: lucide-react

Tree-shaken SVG components with a stroke weight that matches a 1 px-rule design, imported one icon at a time.
The old app's icon font shipped every glyph whether it was drawn or not, and a font is the wrong container for
something that has to take `currentColor` and a stroke width.

### Progressive web app: vite-plugin-pwa

Workbox generates the service worker; the manifest is the one the Angular app already had, kept in `public/`
because it still fits — same name, same icons, the brand blue as theme colour. Precached is the shell, the two
catalogues and the latin fonts, about 680 KiB; the drawings under `assets/` and the onboarding videos are tens of
megabytes and are cached once they are actually looked at. The app updates itself (`registerType: 'autoUpdate'`)
rather than asking. A native store build, if it comes, wraps this same bundle — which is why the build stays a
plain static directory with no server half and no framework-specific output.

### Types: only from `@fg2/shared-types/v1`

Every shape on the wire is imported from the contract, and `verbatimModuleSyntax` plus a lint rule make those
imports explicitly type-only, so the package — which is types and an intentionally empty JavaScript module —
never reaches the bundle. `strict` is on, for the reason the server has it on: the contract says "none is
`null`", and only `strictNullChecks` keeps that null in the types the app is written against.

### Lint, format and strictness: the server's discipline

`eslint.config.mjs` is the server's flat config — typescript-eslint's recommended set with prettier deciding
formatting, the same `.prettierrc`, and the same two overrides, `no-explicit-any` off and a leading underscore
meaning "deliberately unused" — plus the rules of hooks and the fast-refresh rule that React adds. `npm run lint`
and `npm run build` are what they are in `server/`, so "before committing" means the same thing in both.

## What the scaffold contains

`npm run dev` serves on `http://localhost:4200` against the API named in the root `.env`; `npm run build` type
checks and bundles to `dist/`, which the nginx image serves. `npm test` runs what needs nothing but the
checkout, and `npm run test:live` runs the tests that need a stack up — one of which signs in and reads
`/v1/devices` through the app's own session and client.

In place: the shell with the five tabs and the account page, the session with its refresh and its media token,
the query client, both catalogues with the device-message resolver, the tokens in both modes, the ECharts
binding, and a placeholder behind each route. The screens themselves are empty on purpose: the look lands in the
next pass and the screens in the slices after it.

## What was kept from the Angular app

The message catalogues and the help pages under `assets/i18n/`, the PWA manifest and its icons, the product and
hardware drawings under `assets/`, the onboarding videos, the nginx configuration and the shape of the
two-stage `Dockerfile`. What went is Angular, Ionic and Capacitor, the Karma and Jasmine setup, the old type
system's font files, and the client-side demo fixtures — the demo is a session the API issues now.

## Consequences

- A second opinion about validation is gone: a form that should refuse something has to be refused by the
  contract's schema on the server, or it is not refused at all. That is one rule in one place, and it is the
  server's.
- Bundle size is a number somebody has to keep watching. The shell is about 137 kB gzipped with nothing drawn
  yet; charts are registered piecemeal and route-level code splitting is available but not needed yet.
- The catalogues are fetched before the first render, which costs one request on a cold load. A frame of raw
  translation keys is worse.

## Open questions

1. **A browser end-to-end runner.** Playwright is the obvious choice and nothing here needs it yet; the question
   is worth deciding when the first screen with a flow through it lands, not before.
2. **The native wrapper.** The record says a store build may follow. Capacitor is what the old app was
   configured for and its config was never filled in; the build output is a plain static directory, so this stays
   open without costing anything.
3. **Which screens are code-split.** Everything is in one chunk while the screens are empty. The timelapse
   composer and the charting view are the two that will be worth splitting off.
