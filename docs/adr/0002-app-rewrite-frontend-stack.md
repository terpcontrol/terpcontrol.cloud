---
summary: Which libraries the React web app is built from and why, its session and API client, its service worker, and the look its design tokens carry - read before adding a dependency, changing the build, the service worker, the fonts or a token
updated: 2026-11-26
source: Chris (2026-11-25 master's look preferred to "Nebel"; 2026-11-26 "Marke fein" chosen from three drafted directions, with the navy rail and a Start between calm and full, and the same day master's cockpit back on a place's Start); the look's build session of 2026-11-26 (its values, Inter's digit rule, the control radius, the overlays' weights); its fix round after the critic's walk, 2026-11-26 (a figure's tracking, the rail's focus ring and count, the small curve's band); giving a device up and removing a socket confirmed in the danger style, a switch's own target (the third whole-app walk's fix round, 2026-11-14); one answer to every question, a dotted term's own box and a tab row without a veil (the redesign session's fix round of 2026-11-14); Chris (platform 2026-09-16, the brand look 2026-09-24, releases take over at once 2026-10-09, the rail's look with the navigation redesign 2026-11-12, the look "Nebel" chosen and the green kept for the one action 2026-11-13; the cut "1" narrower, every page centred, the lamp's light value kept, a logo on the share card, 2026-11-13); the redesign session of 2026-11-13 after the whole-app walk's third report (one danger style, one logo in the phone's bar); the redesign session of 2026-11-13 (Nebel's values; after the whole-app walk the digit rule, the weights, the lamp's two values, paper light, the overlays' figures); rewrite sessions and the commits of PR #104 (2026-09-18..10-04); checked against webapp/ on 2026-10-08
paths:
  - webapp/package.json
  - webapp/vite.config.ts
  - webapp/eslint.config.mjs
  - webapp/src/sw.ts
  - webapp/src/app/update.ts
  - webapp/src/api/**
  - webapp/src/theme/**
  - webapp/src/charts/**
---
# ADR 0002: The libraries the rewritten web app is built from

- **Status:** accepted on 2026-09-18. The choices below are what `webapp/` is scaffolded on. Amended on
  2026-09-24: the look the libraries carry is the company's brand; it superseded "Greenhouse", which had replaced
  "Instrument". Amended on 2026-11-13: the look was "Nebel", which superseded the brand look. Amended on
  2026-11-26: the look is "Marke fein", recorded under [The look](#the-look-marke-fein) - the brand's face and
  palette with a lighter hierarchy and the navy rail -, which supersedes "Nebel". Also amended on
  2026-09-18 (the app runs the contract's schema-free modules, see [Types](#types-only-from-fg2shared-typesv1)),
  2026-09-22 (the service worker is written by hand, for Web Push) and 2026-09-25 (the tabular digits come from a
  face of their own). Built and merged with #104 on 2026-10-04.
- **Date:** 2026-09-18, amended 2026-09-18, 09-22, 09-24, 09-25, 11-13 and 11-26
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
and no shadows - then "Greenhouse", a warm organic look with serif titles, then the company's own brand as
terpcontrol.com sets it, then "Nebel", a light type on warm paper, and is now "Marke fein", the brand again with a
lighter hierarchy, described [below](#the-look-marke-fein).

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
turns every failure into an `ApiError` (`src/api/problem.ts`) carrying the `application/problem+json` document —
`errors[]` keyed by field, which is exactly what a form needs. That is about a hundred lines and it ends there;
axios would add a dependency for retries and interceptors the platform's `fetch` and one wrapper already give, and
a generated client would restate the routes that the contract's types already describe.

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
Both catalogues are fetched at start-up rather than bundled, so their text - about 300 kB a language by now - stays
out of the JavaScript, and the service worker precaches them so an offline reload still has words.

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
names on `:root`, redefines them under `@media screen and (prefers-color-scheme: dark)` for a system that asks for
dark and has not been overruled and again under `:root[data-theme="dark"]` inside `@media screen` for the manual
toggle - for the screen only, so paper is light whatever the theme (a report printed from the dark theme was its
pale ink on white; `test/paper.test.ts`), and a component's own
`.module.css` says `var(--card)` or `var(--temperature)`. Switching mode is therefore one attribute on `<html>`:
no provider, no re-render, nothing to keep in step. Tailwind would mean restating the same palette in a config
and would invite the literals back in as arbitrary values; a CSS-in-JS library would move colours into the
JavaScript bundle and make the theme a React concern, which it is not. The one place a variable cannot reach is
ECharts' canvas, so `src/charts/tokens.ts` reads the computed values off the document and hands them over —
still one source, read rather than duplicated.

Fonts are self-hosted through `@fontsource-variable`, with the axes the look uses (see below) and the latin and
latin-ext cuts precached. Google Fonts would be a third-party request on every load, which an installed app cannot
rely on and which tells somebody else who opened the app.

### The look: "Marke fein"

The app wears "Marke fein" (Chris, 2026-11-26): the company's brand as terpcontrol.com sets it - Inter, the brand
blue and green, the cool white and blue-grey surfaces, the navy of the site's dark sections - under a lighter
hierarchy, with the desktop rail in the site's navy. `webapp/src/theme/tokens.css` is where every value below is
written; this section says what they are and why, and the two change together. The page's structure - the frame,
the wide layouts, the shared layer in `webapp/src/ui` - is not part of the look and did not change with it.

**How it was chosen.** On 2026-11-25 Chris found master's look - the brand look this section recorded from
2026-09-24 - better than "Nebel", the branch's look (below): its type, its colours, and an overview that draws
less. A designer drew three directions on the branch's structure: "Marke" (the brand look unchanged), "Marke
fein" (its colours and shapes with lighter type) and "Marke weich" (its type with softened colours and shapes).
He chose "Marke fein" with two changes: the desktop rail stays the brand look's navy rather than the light rail
the direction proposed, and Start sits between the calm overview and the fuller one, a small picture and small
curves - which the same day gave way, for a place's own Start, to master's cockpit tiles and its big picture,
drawn in these tokens (app-ux.md §2). The direction's case, as the designer put it: the lighter type answers his complaint of
2026-11-13 about the brand look - bold everywhere, nothing fine - without leaving its face or its palette; the
weight stays where it orients, a page's title and a name, and comes off figures, buttons, chips, tags and section
labels. What stands from every look before: no serif anywhere (Chris, 2026-09-24), no monospaced face on figures, the brand's own logo and green.

**It supersedes "Nebel"** (Chris, 2026-11-13 to 11-25): Albert Sans in three weights and nothing bold, light
titles and figures, a warm paper under navy ink, the signals tuned to one lightness, a chosen chip as a wash with
a ring, radii 12 / 18 / 24 and a light rail. It was tried because the brand look's type read heavy and its
colours neither soft nor in tune (Chris, 2026-11-13); seen beside master again on 2026-11-25, he preferred
master's type, its colours and its overview. What Nebel's rounds decided beyond its values stays: the
digit rule (Face), one danger style, the lamp's own colour, nothing in capitals, paper light whatever the theme.

**Face.** One family, OFL, self-hosted: **Inter Variable** (`@fontsource-variable/inter`, the weight and
optical-size axes, `opsz.css`), as the site's own stack names it. Self-hosting gives the look on every
platform, where the bare stack would be San Francisco on a Mac, Segoe on Windows and Roboto on Android. The
optical-size axis cuts a 12 px caption open and a 32 px title tight (`font-optical-sizing: auto` on headings).
**Digits of one width** come from a face of their own: `webapp/scripts/tabular-digits.py` cuts Inter's tabular
digits (0-9 only, both axes kept) into `src/theme/inter-tabular-digits.woff2`, 6 KB, and `--font-figure` names it
ahead of Inter - digits a digit wide, everything else Inter at its own width. Not `font-variant-numeric:
tabular-nums`: in Inter that feature widens the hyphen, the stops, the colon, the brackets and the space as well,
so a caption came out "long - press". **It is for figures that stand under one another or change in place** - a
table's column, an axis, a list's time column, a stepper's value, a countdown, Verlauf's cursor line - and for
nothing else (the redesign session of 2026-11-13); app-ux.md §9 lists the uses. The rule was made for Albert
Sans, whose cut "1" had to be centred on a zero's width and left a hole on either side; Inter's tabular "1" is
drawn for its width and the hole is far smaller, so that half of the reason is moot. The rule stays for the
other half: a tabular "1" still stands looser than the face's own in a date, a title or a large figure, and a
figure that stands alone gains nothing by the width. In running text Inter's contextual alternates turn a typed
"120x120" into "120×120"; where a name is edited and must read as typed - "Ort bearbeiten" - they are off
(`font-variant-ligatures: no-contextual`). The server draws its overlays in the same face:
`server/scripts/install-fonts.mjs` unpacks `@fontsource/inter` at 400, 500 and 600 into the image for librsvg.

**Hierarchy** comes from weight and size, never from a second family, and only a page's title is heavy: a title
650, closed up by -0.02 em, in `--heading` (the dark brand blue in light mode, white in dark); a thing's name and
a section's heading (`h2`, `.name`, a day's or a sheet's title) 600 at -0.01 em in the same ink, as is the current
tab of a page's tabs, of the rail and of the phone's bar; figures 500, two pixels larger than the brand look set
them at 600, closed up half as far as a title, -0.01 em (`--tracking-figure`, as master's figures were: at the
title's -0.02 em "1,09" pinched at its comma); a button's, a chip's, a tag's and a link's words, a value in a row and a section label 500
(`--weight-medium`); text 400, as is an idle tab. What a browser sets bold by itself - `b`, `strong`, `th`, `h3`,
`h4`, `optgroup` - is brought to the medium in `global.css`, and a weight is only ever one of the five tokens
(`--weight-regular / medium / figure / title / heading`; `test/weights.test.ts`). In a region dimmed by age the
heading ink steps down with the rest of the ink.

**Scale** (px): 11.5 for the caption under a bar's icon and the smallest note; 12 / 13.5 / 15 / 17 / 22 for text
(`--text-xs` to `--text-xl`, 15 is body); 13 for a section label (`--text-label`); names on cards 17 on a phone
and 18 on a desktop; page titles 26 and 32, 24 below 360 px; the big card figure 27 and 30 - temperature,
humidity and VPD with their units still fit one line of a 390 px phone card. Body line height is 1.5, tight 1.2.

**Section labels** are 13 px at the medium, in sentence case, in the label colour. **Nothing in the app is set in
capitals** (`test/weights.test.ts`). A `header` whose first child is a `.label`, or a label straight inside a
`section`, stands on a hairline rule.

**Palette.** Brand blue is navigation, links, focus and whatever is chosen; brand green is the one primary action
and "good" - live, in band, a grow's stage; everything else is the site's cool white and blue-grey with dark ink.
The brand green is a surface colour: as text on white it reaches only 3.3:1, so green words take the site's text
green, and on dark the site's pale green. The signal colours are kept apart from both brand colours and from
each other, because a chart is read against them: humidity is a teal, never the brand's blue, and CO₂ a violet
that leans to magenta rather than to the blue. Every text colour clears WCAG AA on the page, the card and the
inset surface of its own mode: the lowest are the primary button's white on `#3e8024`, 4.86:1 (the site's own
primary), the temperature orange on the inset surface, 4.95:1, and the dark mode's alarm pink there, 5.0:1.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--bg` | `#f5f7fb` | `#14264a` | the page: the site's subtle grey / its navy |
| `--card` | `#ffffff` | `#1a2f58` | cards, sheets |
| `--card-2` | `#eef2f8` | `#213a69` | inset surfaces, fields, quiet actions |
| `--rule` | `#e3e7ef` | `#2c4677` | hairlines (the site's border) |
| `--rule-strong` | `#cbd3e1` | `#4a6598` | a field's edge, a dashed outline, an outlined button |
| `--control-edge` | `#7a849a` | `#8193bd` | an off switch's edge, 3:1 on a card |
| `--ink` | `#1a1d29` | `#f1f4fa` | text |
| `--muted` | `#5a6275` | `#b9c4dc` | secondary text |
| `--label` | `#586074` | `#aab7d3` | labels, captions |
| `--heading` | `#1f3a6e` | `#ffffff` | titles and names |
| `--brand` | `#2d4b95` | `#b8d4ff` | active tab, links, focus, a secondary button's words, VPD's curve |
| `--on-brand` | `#ffffff` | `#14264a` | text on the brand |
| `--brand-wash` | `#e8eef9` | `#2a4a86` | behind whatever is selected |
| `--selected` / `--selected-edge` | `#2d4b95` / same | `#2a4a86` / `#b8d4ff` | a chosen chip or segment: fill and ring |
| `--on-selected` | `#ffffff` | `#ffffff` | text on a choice |
| `--green` | `#50a030` | `#6fbe4a` | live dots, in-band marks, reached segments, a grow's progress |
| `--green-ink` | `#35701f` | `#c2eca0` | green text |
| `--green-wash` | `#eaf4e4` | `#244a45` | behind a green word: live, a stage, the current step |
| `--green-fill` / `--on-green` | `#3e8024` / `#ffffff` | the same | the primary action's fill and its words |
| `--alarm-fill` / `--on-alarm` | `#b8213d` / `#ffffff` | the same | the yes to a step that cannot be taken back (6.3:1), the rail's count of what is open |
| `--temperature` | `#b93f0b` | `#ffa166` | orange |
| `--humidity` | `#08737f` | `#5fd4cf` | teal |
| `--co2` | `#8a3aa8` | `#dca5f5` | violet |
| `--warning` | `#855800` | `#f2c35a` | amber, for what is actually wrong |
| `--alarm` | `#b8213d` | `#ff8b9a` | crimson; what is open - the bell's dot, a critical line, an alarm's words |
| `--warning-wash` / `--warning-edge` | `#fff6db` / `#e8b53d` | `--card-2` / `#f2c35a` | a warning's ground and edge |
| `--alarm-wash` / `--alarm-edge` | `#fdecef` / `#eba2ae` | `--card-2` / `#ff8b9a` | an alarm's ground and edge |
| `--output` | `#4870c0` | `#8fb0ea` | what an output did: lanes, output lines |
| `--lamp` | `#e8b53d` | `#f2c35a` | the lamp's light on a lane and a lit day |

Rules that hold from the looks before: **no signal is mixed into a surface** - amber or red laid into white or
navy came out beige, khaki and mauve - so a warning's ground and edge are written out, and in dark mode a warning
stands on the lifted navy and lets its edge and ink say the rest. **An output running is not a warning**: lanes
and output lines take the light brand blue. **The lamp has its own colour** (`--lamp`): the amber of a warning's
edge, never the darker amber a warning is written in (Nebel's rounds gave it a colour of its own; its first value
had been the warning's). **A choice is filled**: a chosen chip or segment is the brand blue under white words in
light mode, and in dark mode a navy fill with a pale-blue ring and white words, because the site keeps its pale
blue for links; a pressed series chip is filled with its line's colour in light mode and is the navy choice with
a mark of the line's colour in dark. Sliders and an on switch take the surface green, since the primary's darker
fill came to 2.7:1 on the dark card, under the 3:1 a control needs. The top of the page carries a faint glow of
the brand blue (`--glow`), on the phone's top bar as well, so the two meet without a seam.

The primary fill is the site's `#3e8024` in both modes. **The desktop rail is navy in both modes** (Chris,
2026-11-26, against the light rail "Marke fein" first drew) - the site's dark sections round a light page: the
spotlight's stops `#2d4b95` → `#1f3a6e` → `#14264a` run top to bottom (`--navy`), with white text, `#cdd7ec` for
the idle items (5.7:1 on the lightest stop), a white pane at 14 % behind the current item and its icon in the pale
green, the place group a box at 5 % white with a hairline at 10 %, the place chip a pane of white with a 16 %
edge, Eintrag the green full width, and Meldungen's count the alarm's crimson under white (`--alarm-fill`; the dark
mode's alarm ink as a fill was a pink badge). The focus ring on the rail is white (`--navy-ink`): the brand blue is
the navy's own top stop, and a ring in it came to 1.2:1 there. Captions over photographs sit on
smoked navy (`--overlay`) in both modes, because the picture does not change with the theme; a button over a
photograph is solid (`--overlay-solid`). The toast is the dark brand blue in light mode and a raised navy in dark.
The sign-in and sign-up cards stand on the site's spotlight (`--spotlight`) in both modes.

**The logo** is the brand's own, `public/assets/brand/logo.png`, in the rail, the phone's top bar, the sign-in
and sign-up cards, the public pages' bar and the error page, in place of a typeset name. The phone's top bar shows
the logo's shield on every page, the rail the whole logo reversed (the redesign session of 2026-11-13: the bar
showed the shield beside the place chip and the wordmark, with a tagline about 4 px high, elsewhere). A share
link's card carries the reverse logo in its top corner (Chris, 2026-11-13;
`server/src/modules/v1/sharing/brand-mark.ts`, embedded because the image ships only `dist`), and its scrim is dark
at the top too, so the logo reads over a bright photo. On a dark surface it is `logo-reverse.png`, which is
derived from the colour logo by `webapp/scripts/derive-logo.mjs` rather than retouched: per pixel, how much of
the logo's blue it holds becomes white, how much of its green keeps its own colour, and the logo's white drops
out so the dark ground shows through the knockouts. A `Logo` component draws both and `--logo-colour` /
`--logo-reverse` say which one shows, so it follows the theme and the rail sets it for itself. The favicon and the
installed app's icons are the logo's shield.

**Charts** take every colour from these tokens through `src/charts/tokens.ts`: a line in its signal colour, VPD
in `--brand`, hand-written readings in ink, outputs in `--output`, the lamp in `--lamp`; the target band `--band`
(the brand green at 14 %; on navy a yellower green at 22 %, which the brand green turned slate teal beside the
humidity line), the nights `--night` as a faint wash of the dark blue (black-navy in dark mode), halved over a
long range so a month of nights does not read as a barcode, and three faint rules across each plot in `--grid`.
The 24-hour curves of Start's tiles take `--band-small`, which in dark mode is half the band's strength: at that size the
full band drew two green blocks the line hid in.
A series chip and the pinned reading's stroke are the legend. The server's timelapse overlays and share-link
cards use the dark palette's ink, muted ink, navy plate and signal colours, in Inter - a reading at 500, the day
counter and a card's title at 600. An overlay writes its figures as the app does for the owner - the owner's
language and decimal mark, the app's decimals ("25,6 °C") - and draws its curve inside its box, the caption bar as
wide as the box, fitted by Inter's own advance widths; a share card and the page around it are in the owner's
language.

**Icons** are lucide's at a stroke of 1.75 (`svg.lucide` in `global.css`), a step finer than its own 2, as the
type is a step lighter than the brand look's.

**Shape.** The site's radii, a control a step rounder: 12 px for a card, 8 px for a control - every button,
field, stepper and the native menus -, 20 px for a large panel, 6 px for the option inside a segmented track
(whose track is 10). A chip that is a choice - a range, a place, a series -, a tag, the live pill, a status pill
and a badge are pills, as the site keeps pills for badges and filters; a button never is. 1 px rules; under a card
in light mode the site's low two-layer shadow tinted with the dark blue (`0 1px 2px rgb(31 58 110 / 6%), 0 1px
3px rgb(31 58 110 / 4%)`), raised things its larger one; in dark mode an inset top highlight and a deep drop
shadow. A field is 44 px tall, a card's repeated action 36, a chip 30. The one primary action on a screen is
filled green; the quieter actions a card repeats (Photo, Note, Alarms off) are a filled tint with no outline;
everything else is the site's ghost button - white, its words in the brand blue at the medium, an edge that turns
blue under the pointer. **One danger style** (the redesign session of 2026-11-13, after the third critic found
four): the yes to a step that cannot be taken back - removing a member, a place or a socket, giving a device up,
revoking a share link, switching regulation off, deleting an alarm, a scheme, a build or the account - is filled
with `--alarm-fill` under white `--on-alarm` in both modes, never the brand green, and is armed in one step; it is
the yes of the shared `Asking` with `danger` (`.dangerFilled`, `ui/ui.module.css`). Every question's yes - danger,
primary or quiet - stands with "Abbrechen" beside it in one part, `Answer` (`ui/Asking.tsx`), at a control's
44 px and radius (the redesign session of 2026-11-14). The control that opens such a question is outlined in the
alarm red (`.dangerOutline`), and nothing else is; a yes that waits for something typed (the handle before
deleting the account) looks like a primary that cannot be pressed. A dotted term (`Term`, `ui/Help.module.css`)
is a box of its own, 9 px of room above and below its words held out of its line by a margin as deep, so it is a
finger's target without growing its line; a page's row of tabs fits from 320 px and has no veil at its edge (the
redesign session of 2026-11-14). A switch is drawn 42×24 and tapped as 44 px both ways, its target its own
(`.switch::after`), so no page adds one (the third whole-app walk).

**Spacing.** A 4 px unit: 4, 8, 12, 16, 24 and 36 inside a page, 48 and 64 between the sections of a long one;
a card's padding is 16 on a phone and 20 from 900 px.

**Layout.** Phone first: a solid top bar of 60 px (the shield, the place chip, the bell with a red dot while
something is open, Ich) and a solid bar of 64 px at the foot, the green Eintrag circle of 44 px inside it, every
item's name on one line, the current one in the brand blue at a name's weight. From 900 px the 248 px navy rail
replaces both and every screen, a reading page as much as a wide one, is centred in the space it leaves (Chris,
2026-11-13). Three widths: 560 px for a form or sheet, 760 px for a reading column (settings, lists, Me, Tasks,
Alerts), and 1180 px for a page that uses the screen - Start (two columns of cards from 1200 px, the two of a row
stretched to one height with their actions at the foot), a space's overview, its Timeline, a grow's weeks and
feeding chart, and a camera.

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

*Amended 2026-09-22:* Workbox no longer generates the worker. A browser hands a push to the service worker and to
nothing else, and a generated worker has no handler for one, so a Web Push subscription would have reached
nobody. The worker is written out in `src/sw.ts` (`strategies: 'injectManifest'` in `vite.config.ts`): it
precaches what the generated one did - the list is still decided in `vite.config.ts`, the tabular-digits face
included - keeps `assets/` once looked at, and adds the two push handlers, one that shows the announcement and
one that lands a tap on the inbox or the task list. It calls neither `self.skipWaiting()` nor `clientsClaim()`,
which the plugin adds only to a worker it generates, so despite `registerType: 'autoUpdate'` a new release takes
over only once every window of the app has been closed; whether that stays is open question 4.

*Amended 2026-10-08:* the old app's onboarding videos, drawings and help pages are gone from `assets/`. What the
worker keeps once looked at is what is left there - the app icons, the logos and the feeding schemes, under a
megabyte together.

*Amended 2026-10-09 (Chris):* a new release takes over at once again, as the record first said. A colleague had to
empty the browser's cache to see a release, because the hand-written worker waited for every window to close. It
now calls `skipWaiting()` and `clients.claim()`, and the page reloads itself once when a new worker claims it
(`src/app/update.ts`), so the code that runs and the files the worker answers with are always one release. The
page also asks for an update whenever it comes back to the front. The price is accepted: a screen open in the
middle of an entry reloads when a release lands, which happens seldom and costs that entry.

### Types: only from `@fg2/shared-types/v1`

Every shape on the wire is imported from the contract, and `verbatimModuleSyntax` plus a lint rule make those
imports explicitly type-only, so the package — which is types and an intentionally empty JavaScript module —
never reaches the bundle. `strict` is on, for the reason the server has it on: the contract says "none is
`null`", and only `strictNullChecks` keeps that null in the types the app is written against.

*Amended 2026-09-18 to 10-03:* the app also runs code from the contract - the arithmetic both ends must agree on,
which `shared-types` keeps in modules without a schema (feeding, grow days, day and night, value ages, climate
presets, configuration fields, the socket report and a few more; ADR 0001, Conventions). They are imported one by
one as `@fg2/shared-types/v1-schemas/<module>.js` and listed in `optimizeDeps.include` in `vite.config.ts`, because
a linked CommonJS package is not pre-bundled unless it is named. Never the index: it would bring zod and every
schema with it, which is why the forms (above) are not validated in the client.

### Lint, format and strictness: the server's discipline

`eslint.config.mjs` is the server's flat config — typescript-eslint's recommended set with prettier deciding
formatting, the same `.prettierrc`, and the same two overrides, `no-explicit-any` off and a leading underscore
meaning "deliberately unused" — plus the rules of hooks and the fast-refresh rule that React adds. `npm run lint`
and `npm run build` are what they are in `server/`, so "before committing" means the same thing in both.

## What the scaffold contains

The scaffold of 2026-09-18 held the shell and the account page, the session with its refresh and its media token,
the query client, both catalogues with the device-message resolver, the tokens in both modes, the ECharts binding
and a placeholder behind each route. Every placeholder has since been replaced by its screen - the last, the page
for an unknown address, in #104 - so the scaffold is the app. `npm run build` type checks and bundles to `dist/`,
which the nginx image serves; `npm test` runs what needs nothing but the checkout (Vitest, jsdom), and `npm run
test:live` the tests that need a stack up. Serving it against a local stack is in `CLAUDE.md`.

## What was kept from the Angular app

The message catalogues and the help pages under `assets/i18n/`, the PWA manifest and its icons, the product and
hardware drawings under `assets/`, the onboarding videos, the nginx configuration and the shape of the
two-stage `Dockerfile`. What went is Angular, Ionic and Capacitor, the Karma and Jasmine setup, the old type
system's font files, and the client-side demo fixtures — the demo is a session the API issues now.

## Consequences

- A second opinion about validation is gone: a form that should refuse something has to be refused by the
  contract's schema on the server, or it is not refused at all. That is one rule in one place, and it is the
  server's.
- Bundle size is a number somebody has to keep watching. The empty shell was about 137 kB gzipped; with every
  screen built the app is still one chunk, about 560 kB gzipped in the build of 2026-10-04. Charts are registered
  piecemeal, and route-level code splitting (open question 3) is the lever left.
- The catalogues are fetched before the first render, which costs one request on a cold load. A frame of raw
  translation keys is worse.

## Open questions

Three are open (2026-10-09); the fourth is decided.

1. **A browser end-to-end runner.** Playwright is the obvious choice and nothing here needs it yet; the question
   is worth deciding when the first screen with a flow through it lands, not before. Every screen has landed
   since. Agents drive the app with Playwright and the installed Chromium to check a slice, but no browser suite
   is committed and CI runs none; the app's own tests are Vitest under jsdom.
2. **The native wrapper.** The record says a store build may follow. Capacitor is what the old app was
   configured for and its config was never filled in; the build output is a plain static directory, so this stays
   open without costing anything.
3. **Which screens are code-split.** Nothing is yet: the whole app is one chunk (see Consequences). The timelapse
   composer and the charting view are the two most worth splitting off.
4. ~~**Does a new release take over at once again?**~~ Decided 2026-10-09: yes, with a reload (see the progressive
   web app).
