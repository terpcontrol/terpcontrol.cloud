# ADR 0002: The libraries the rewritten web app is built from

- **Status:** accepted on 2026-09-18. The choices below are what `webapp/` is scaffolded on. Amended on
  2026-09-24: the look the libraries carry is the company's brand, recorded under
  [The look](#the-look-the-brand); it supersedes "Greenhouse", which had replaced "Instrument".
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
and no shadows - then "Greenhouse", a warm organic look with serif titles, and is now the company's own brand as
terpcontrol.com sets it, described [below](#the-look-the-brand).

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

### The look: the brand

The app wears the company's own brand, as terpcontrol.com sets it: its colours, its plain sans and its radii.
`webapp/src/theme/tokens.css` is where every value below is written; this section says what they are and why, and
the two change together. The page's structure - the frame, the wide layouts, the two-column Home, the shared
layer in `webapp/src/ui` (groups, joined rows, the one segmented control, figure strips, the page title's edge,
age said by ink rather than opacity) - is not part of the look and did not change with it.

**It supersedes "Greenhouse"**, the warm organic look this section recorded before: Fraunces serif titles and
wordmark over Nunito Sans, oat paper and warm charcoal, a forest green for the brand. It was rejected by the owner
for two reasons, and both are now rules. A serif is for special occasions only, and the app has none: no name,
title, heading or figure is set in a serif anywhere. And the app follows the brand's colours rather than a
palette of its own, so a grower who comes from the website finds the same blue, the same green and the same
logo in the app. "Instrument", the look before Greenhouse (IBM Plex Sans, JetBrains Mono on every figure), stays
retired for the reasons it was retired: a monospaced face on every string, one weight, grey on grey.

**Face.** One family, OFL, self-hosted: **Inter Variable** (`@fontsource-variable/inter`, the weight and
optical-size axes, `opsz.css`). The site sets its text in the system's sans and names Inter in that stack;
self-hosting Inter gives the app that look on every platform, where the bare stack would be San Francisco on a
Mac, Segoe on Windows and Roboto on Android. Inter's figures are turned tabular for the whole app
(`font-variant-numeric: tabular-nums` on `body`), so a column of readings lines up without a second, monospaced
face, and `--font-figure` is the same family. The optical-size axis cuts a 12 px caption open and a 32 px title
tight without anybody asking. The server draws its overlays in the same face: `server/scripts/install-fonts.mjs`
unpacks `@fontsource/inter` at 400, 600 and 700 into the image for librsvg.

**Hierarchy** comes from weight and size, as the site's headings do, never from a second family. A page's title
is 700, closed up by -0.02 em, in `--heading` (the dark brand blue in light mode, white in dark); a thing's name
and a section's heading (`h2`, `.name`, a sheet's title, a week's heading) are 650 at -0.01 em in the same ink;
section labels are the small tracked capitals below; body is 400, medium 500, semibold 600, bold 700, figures
600. In a region dimmed by age the heading ink steps down with the rest of the ink.

**Scale** (px): 11.5 for section labels only; 12 / 13.5 / 15 / 17 / 22 for text (`--text-xs` to `--text-xl`,
15 is body); names on cards 17 on a phone and 18 on a desktop; page titles 26 and 32; the big card figure 25 and
28 - sized so that temperature, humidity and VPD with their units fit one line of a 390 px phone card. Body line
height is 1.5, tight lines 1.2.

**Section labels** are the one thing set in capitals: 11.5 px, bold, tracked 0.08 em, in the label colour. A
`header` whose first child is a `.label`, or a label straight inside a `section`, stands on a hairline rule.

**Palette.** Brand blue is navigation, links, focus and whatever is selected; brand green is the one primary
action and "good" - live, in band, a grow's stage; everything else is the site's cool white and blue-grey with
dark ink. The brand green is a surface colour: as text on white it reaches only 3.3:1, so green words take the
site's text green, and on dark the site's pale green. The signal colours are kept apart from both brand colours
and from each other, because a chart is read against them: humidity is a teal, never the brand's blue, and CO₂ a
violet that leans to magenta rather than to the blue. Every text colour clears WCAG AA on the page, the card and
the inset surface of its own mode, measured over every route in both modes at 1440 and 390 px and in German: the
lowest is the primary button's white on `#3e8024`, 4.86:1 (the site's own primary), and everything else is 5.3:1
or more.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--bg` | `#f5f7fb` | `#14264a` | the page: the site's subtle grey / its navy |
| `--card` | `#ffffff` | `#1a2f58` | cards, sheets |
| `--card-2` | `#eef2f8` | `#213a69` | inset surfaces, fields, quiet actions |
| `--rule` | `#e3e7ef` | `#2c4677` | hairlines (the site's border) |
| `--rule-strong` | `#cbd3e1` | `#4a6598` | a field's edge, a dashed outline |
| `--control-edge` | `#7a849a` | `#8193bd` | an off switch's edge, 3:1 on a card |
| `--ink` | `#1a1d29` | `#f1f4fa` | text |
| `--muted` | `#5a6275` | `#b9c4dc` | secondary text |
| `--label` | `#586074` | `#aab7d3` | labels, captions |
| `--heading` | `#1f3a6e` | `#ffffff` | titles and names |
| `--brand` | `#2d4b95` | `#b8d4ff` | active tab, links, focus, a secondary button's words |
| `--on-brand` | `#ffffff` | `#14264a` | text on the brand |
| `--brand-wash` | `#e8eef9` | `#2a4a86` | behind whatever is selected |
| `--selected` / `--selected-edge` | `#2d4b95` / same | `#2a4a86` / `#b8d4ff` | a chosen chip or segment: fill and ring |
| `--on-selected` | `#ffffff` | `#ffffff` | text on a choice |
| `--green` | `#50a030` | `#6fbe4a` | live dots, in-band marks, reached segments |
| `--green-ink` | `#35701f` | `#c2eca0` | green text |
| `--green-wash` | `#eaf4e4` | `#244a45` | behind a green word: live, a stage, the current step |
| `--green-fill` | `#3e8024` | `#3e8024` | the primary action's fill, under white words only |
| `--on-green` | `#ffffff` | `#ffffff` | text on the fill |
| `--temperature` | `#b93f0b` | `#ffa166` | orange |
| `--humidity` | `#08737f` | `#5fd4cf` | teal |
| `--co2` | `#8a3aa8` | `#dca5f5` | violet |
| `--warning` | `#855800` | `#f2c35a` | amber, for what is actually wrong |
| `--alarm` | `#b8213d` | `#ff8b9a` | crimson |
| `--warning-wash` / `--warning-edge` | `#fff6db` / `#e8b53d` | `--card-2` / `#f2c35a` | a warning's ground and edge |
| `--alarm-wash` / `--alarm-edge` | `#fdecef` / `#eba2ae` | `--card-2` / `#ff8b9a` | an alarm's ground and edge |
| `--output` | `#4870c0` | `#8fb0ea` | what an output did: lanes, output lines |

Two rules came out of checking the first brand pass against the site. **No signal is mixed into a surface**:
amber or red laid into white or navy with `color-mix` came out beige, tan, khaki and mauve - the rejected warm
paper under another name - so a warning's ground and edge are written out, and in dark mode a warning stands on
the lifted navy and lets its amber edge and ink say the rest. A finished alert keeps its stripe in the strong rule
rather than a signal at half strength. And **an output running is not a warning**: the lanes and output lines take
the light brand blue. Selection in dark mode is a navy fill with a pale-blue ring and white words, because the site
keeps its pale blue for links; a pressed series chip there carries its line's colour as a mark rather than as a
pastel fill. Sliders and an on switch take the surface green, since the primary's darker fill came to 2.7:1 on the
dark card, under the 3:1 a control needs.

The primary fill is the site's `#3e8024` in both modes, as the site's dark call-to-action panel uses it. The
desktop rail is navy in both modes - the site's dark sections round a light page, as its hero and footer stand
round its content: the spotlight's stops `#2d4b95` → `#1f3a6e` → `#14264a` run top to bottom, with white text,
`#cdd7ec` for quieter lines (5.7:1 on the lightest stop), a white pane at 14 % behind the current item and its
icon in the pale green. Captions over photographs sit on smoked navy (`--overlay`, `rgb(12 24 48 / 72%)`, text
`#f5f8ff`) in both modes, because the picture does not change with the theme; a button over a photograph is
solid (`--overlay-solid`, `#111f3d`). The toast is the dark brand blue in light mode and a raised navy in dark.
The sign-in and sign-up cards stand on the site's spotlight (`--spotlight`: the radial navy with its green light)
in both modes, so the first screen is the site's first impression.

**The logo** is the brand's own, `public/assets/brand/logo.png`, in the rail, the phone's top bar, the sign-in
and sign-up cards, the public pages' bar and the error page, in place of a typeset name. On a dark surface it is
`logo-reverse.png`, which is derived from the colour logo by `webapp/scripts/derive-logo.mjs` rather than
retouched: per pixel, how much of the logo's blue it holds becomes white, how much of its green keeps its own
colour, and the logo's white drops out so the dark ground shows through the knockouts - the treatment the site's
dark sections give the brand (white type, the green kept). A `Logo` component draws both and `--logo-colour` /
`--logo-reverse` say which one shows, so it follows the theme and the rail sets it for itself. The favicon and
the installed app's icons are the logo's shield.

**Charts** take every colour from these tokens through `src/charts/tokens.ts`: a line in its signal colour (VPD
and hand-written readings in ink, outputs in `--output`), the target band `--band` (the brand green at 14 %; on
navy a yellower green at 22 %, which the brand green turned slate teal beside the humidity line), the
nights `--night` as a faint wash of the dark blue (black-navy in dark mode), halved over a long range so a month
of nights does not read as a barcode, and three faint rules across each plot in `--grid`. A series chip is filled
with its line's colour when it is on, and the pinned reading draws a short stroke in each line's colour before
its name, so the chips and the header are the legend (in dark mode the chip is the navy choice with a mark of
the line's colour). The server's timelapse overlays and share-link cards use
the dark palette's ink, muted ink, navy plate and signal colours.

**Shape.** The site's three radii: 6 px for a control (a button, a field, a rail item), 12 px for a card, 20 px
for a large panel; 4 px for the option inside a segmented track. Every button is 6 px, the small action chips
(Measurements, Share, Silence 1 h, Save view) and the native menus included; a chip that is a choice - a range, a
place, a series, anything pressed or not - stays a pill, as do tags, the live pill and badges, as the site keeps
pills for badges and filters. 1 px rules; under a card in light mode the site's low two-layer shadow
tinted with the dark blue (`0 1px 2px rgb(31 58 110 / 6%), 0 1px 3px rgb(31 58 110 / 4%)`), raised things its
larger one; in dark mode an inset top highlight and a deep drop shadow. A field is 44 px tall, a card's repeated
action 36, a chip 30. The one primary action on a screen is filled green; the quieter actions a card repeats
(Photo, Note, Alarms off) are a filled tint with no outline; everything else is the site's ghost button - white,
its words in the brand blue, an edge that turns blue under the pointer.

**Spacing.** A 4 px unit: 4, 8, 12, 16, 24 and 36 inside a page, 48 and 64 between the sections of a long one;
a card's padding is 16 on a phone and 20 from 900 px.

**Layout.** Phone first, with a frosted top bar and tab bar; from 900 px the navy rail replaces both and each
screen is centred in the space it leaves. Three widths: 560 px for a form or sheet, 760 px for a reading column
(settings, lists, Me, Tasks, Alerts), and 1180 px for a page that uses the screen - Home (two columns of cards
from 1200 px, the two of a row stretched to one height with their actions at the foot), a space's overview, its
Timeline, a grow's weeks and feeding chart, Charts, and a camera.

### Icons: lucide-react

Tree-shaken SVG components with a stroke weight that matches a 1 px-rule design, imported one icon at a time.
The old app's icon font shipped every glyph whether it was drawn or not, and a font is the wrong container for
something that has to take `currentColor` and a stroke width.

### Progressive web app: vite-plugin-pwa

Workbox generates the service worker; the manifest is the one the Angular app already had, kept in `public/`
because it still fits — same name, same icons; its theme and background colours follow the brand's
blue and the page's grey. Precached is the shell, the two catalogues and the face's latin and latin-ext cuts
(200 KiB of it); the drawings under `assets/` and the onboarding videos are tens of
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
