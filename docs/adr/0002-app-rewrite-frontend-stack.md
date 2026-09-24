# ADR 0002: The libraries the rewritten web app is built from

- **Status:** accepted on 2026-09-18. The choices below are what `webapp/` is scaffolded on. Amended on
  2026-09-24: the look the libraries carry is now "Greenhouse", recorded under [The look](#the-look-greenhouse);
  it replaces "Instrument" and its two fonts.
- **Date:** 2026-09-18, amended 2026-09-24
- **Touches:** `webapp/`
- **Builds on:** [ADR 0001](0001-app-rewrite-data-model.md), which fixes the model, the `/v1` API and the
  contract in `@fg2/shared-types/v1`.

## Context

The web app is rewritten from scratch in React against a decided set of screens. Three of that record's rules
reach every choice below: it is **mobile first**, desktop second, tablet third; it is one design for everyone,
with no persona or mode selection; and **every value carries an age** and is dimmed rather than hidden when it is
old. Two more come from outside the screens: the app must be **installable as a progressive web app**, because a
native store build may follow, and it **consumes the contract's types directly**, so no shape is written down
twice. The look was first "Instrument" - IBM Plex Sans, JetBrains Mono for every figure, 8 px corners, 1 px rules
and no shadows - and is now "Greenhouse", a warm paper-and-soil look described [below](#the-look-greenhouse).

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

Fonts are self-hosted through `@fontsource-variable`, with the axes the look uses (see below) and latin subsets
precached. Google Fonts would be a third-party request on every load, which an installed app cannot rely on and
which tells somebody else who opened the app.

### The look: Greenhouse

The first look, "Instrument", read as a terminal: a monospaced face on every figure, label and sentence, every
string at one weight, flat grey-on-grey surfaces, and on a wide screen a phone's column with half the window
empty. Three directions were drawn over the real screens - a calm editorial one, a precise dark-first one and a
warm organic one - and the organic one was chosen, with parts of the other two grafted onto it. It is the one
that looks like a grower's journal rather than an admin panel, and its character lives in tokens (the page
colour, the serif titles, the pill shapes, the green wash) rather than in per-screen layouts, so the forty
screens nobody polishes by hand still inherit it. `webapp/src/theme/tokens.css` is where every value below is
written; this section says what they are and why, and the two change together.

**Faces.** Two families, both OFL and self-hosted:

- **Nunito Sans Variable** (`@fontsource-variable/nunito-sans`, weight and optical-size axes) for every word and
  every figure. Its digits are tabular by default, so a column of readings lines up without a second, monospaced
  face; `.figure` and `.mono` only turn on `tabular-nums`, and `--font-figure` is the same family.
- **Fraunces Variable** (`@fontsource-variable/fraunces`, the full axis set) for the names a person gave things:
  the wordmark, page titles, place names on cards, week headings, sheet titles - every `h1` and `h2`. It is set
  at full softness and never wonky (`--display-axes: 'SOFT' 100, 'WONK' 0`). The optical-size axis is what makes
  one serif work from 15 to 32 px: the browser picks the sturdier text cut for a 17 px card name and the finer
  display cut for a 32 px title. The weight does not follow on its own, so a title is 540 and anything under
  about 22 px steps down to 480; at one weight the small names read as blots.

**Scale** (px): 11.5 for section labels only; 12 / 13.5 / 15 / 17 / 24 for text (`--text-xs` to `--text-xl`,
15 is body); names on cards 17 on a phone and 19 on a desktop; page titles 26 and 32; the big card figure 25 and
28 - sized so that temperature, humidity and VPD with their units fit one line of a 390 px phone card. Body line
height is 1.5, tight lines 1.2. Weights: 420 regular, 560 medium, 680 semibold, 780 bold, 650 for figures.

**Section labels** are the one thing set in capitals: 11.5 px, bold, tracked 0.08 em, in the label colour. A
`header` whose first child is a `.label`, or a label straight inside a `section`, stands on a hairline rule.
Sentence-case labels at 12 px read as body text and a long page lost its sections; the capitals on a rule give
it structure without competing with the figures.

**Palette.** One green means growing, live and "go"; the signal colours are earthy but exact because a chart is
read against them. Every text colour clears WCAG AA with a margin - at least 5:1 on the page, the card and the
inset surface of its own mode - because values that sat at 4.6 were legal and still thin on a real screen.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--bg` | `#f4efe6` | `#13120f` | the page: oat paper / warm charcoal |
| `--card` | `#fffcf7` | `#1d1b17` | cards, sheets |
| `--card-2` | `#f1ebdf` | `#27241f` | inset surfaces, fields |
| `--rule` | `#e5ddcd` | `#34302a` | hairlines |
| `--rule-strong` | `#d6ccb8` | `#484238` | a field's edge, a dashed outline |
| `--ink` | `#22271f` | `#f1ebe0` | text |
| `--muted` | `#60594c` | `#b5ad9e` | secondary text |
| `--label` | `#655d4d` | `#a39a89` | labels, captions |
| `--brand` | `#2c5a37` | `#a9d98d` | active tab, pressed chip, wordmark (light) |
| `--brand-wash` | `#e3ebdc` | `#283523` | behind whatever is selected, the live pill |
| `--green` | `#3b7a34` | `#8fcd6f` | live dots, in-band marks, target lines |
| `--green-ink` | `#2c6427` | `#9fd782` | green text |
| `--green-fill` | `#3b7a34` | `#6aa651` | the primary action's fill, switches |
| `--on-green` | `#ffffff` | `#10190b` | text on the fill |
| `--tint` | `#f1ebdf` | `#2b2822` | quiet actions inside a card |
| `--temperature` | `#9a4212` | `#f0935c` | terracotta |
| `--humidity` | `#1b6590` | `#6bb6dc` | sky |
| `--co2` | `#7447a0` | `#bf9be6` | plum |
| `--warning` | `#7a5405` | `#e3b457` | ochre |
| `--alarm` | `#a82e27` | `#f27e6f` | brick |

The dark green fill is a step below the dark green itself: a large lit fill glares in a dark tent where a dot or a
line does not. Captions over photographs sit on smoked glass (`--overlay`, `rgb(24 21 16 / 70%)`, text
`#fbf7ee`) in both modes, because the picture does not change with the theme; a button over a photograph is solid
(`--overlay-solid`, `#2a2620`), because glass under a control lets a bright frame wash it out.

**Charts** take every colour from these tokens through `src/charts/tokens.ts`: a line in its signal colour (VPD
and hand-written readings in ink, outputs in warning), the target band `--band` (the green at 13 % / 12 %), the
nights `--night` as a faint wash rather than a solid block so a month of nights does not read as a barcode, and
three faint rules across each plot in `--grid`. A series chip is filled with its line's colour when it is on, and
the pinned reading draws a short stroke in each line's colour before its name, so the chips and the header are
the legend.

**Shape.** Cards 16 px, inner tiles, photos and fields 10 px, small tags 6 px; buttons and chips are pills.
1 px rules, and a low warm two-layer shadow under a card in light mode (an inset top highlight and a deep drop
shadow in dark mode) - paper lying on paper. A field is 44 px tall, a card's repeated action 36, a chip 30. The
one primary action on a screen is filled green; the quieter actions a card repeats (Photo, Note, Alarms off) are
a filled tint with no outline, so they sit under the readings instead of over them; everything else is an
outlined pill. A pressed chip is filled with the brand, so which one is on can be seen from across the room.

**Spacing.** A 4 px unit: 4, 8, 12, 16, 24 and 36 inside a page, 48 and 64 between the sections of a long one.

**Layout.** Phone first, with a frosted top bar and tab bar; from 900 px a rail replaces both and each screen is
centred in the space it leaves. Three widths: 560 px for a form or sheet, 760 px for a reading column (settings,
lists, Me, Tasks, Alerts), and 1180 px for a page that uses the screen - Home (two columns of cards from 1200 px,
the two of a row stretched to one height with their actions at the foot, so a short card never leaves a hole),
a space's overview (the tent now beside what was written), its Timeline, a grow's weeks and feeding chart,
Charts, and a camera (the picture and its films beside its settings).

**Why not the other two.** The calm editorial direction had the finest type, but its serif figures were thin
at a glance and it kept one narrow column on a wide screen; its section labels and its paired header links were
taken. The precise direction was the most legible and fitted three figures on a phone, but it was a better-made
version of the instrument look that was being replaced; its hairline readout strips, its quiet filled actions
and its figure sizing were taken.

### Icons: lucide-react

Tree-shaken SVG components with a stroke weight that matches a 1 px-rule design, imported one icon at a time.
The old app's icon font shipped every glyph whether it was drawn or not, and a font is the wrong container for
something that has to take `currentColor` and a stroke width.

### Progressive web app: vite-plugin-pwa

Workbox generates the service worker; the manifest is the one the Angular app already had, kept in `public/`
because it still fits — same name, same icons; its theme and background colours follow the look's forest
green and paper. Precached is the shell, the two
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
