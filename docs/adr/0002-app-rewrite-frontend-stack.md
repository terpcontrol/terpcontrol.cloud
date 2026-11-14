---
summary: Which libraries the React web app is built from and why, its session and API client, its service worker, and the look its design tokens carry - read before adding a dependency, changing the build, the service worker, the fonts or a token
updated: 2026-11-14
source: giving a device up and removing a socket confirmed in the danger style, a switch's own target (the third whole-app walk's fix round, 2026-11-14); one answer to every question, a dotted term's own box and a tab row without a veil (the redesign session's fix round of 2026-11-14); Chris (platform 2026-09-16, the brand look 2026-09-24, releases take over at once 2026-10-09, the rail's look with the navigation redesign 2026-11-12, the look "Nebel" chosen and the green kept for the one action 2026-11-13; the cut "1" narrower, every page centred, the lamp's light value kept, a logo on the share card, 2026-11-13); the redesign session of 2026-11-13 after the whole-app walk's third report (one danger style, one logo in the phone's bar); the redesign session of 2026-11-13 (Nebel's values; after the whole-app walk the digit rule, the weights, the lamp's two values, paper light, the overlays' figures); rewrite sessions and the commits of PR #104 (2026-09-18..10-04); checked against webapp/ on 2026-10-08
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
  "Instrument". Amended on 2026-11-13: the look is "Nebel", recorded under [The look](#the-look-nebel), which
  supersedes the brand look. Also amended on
  2026-09-18 (the app runs the contract's schema-free modules, see [Types](#types-only-from-fg2shared-typesv1)),
  2026-09-22 (the service worker is written by hand, for Web Push) and 2026-09-25 (the tabular digits come from a
  face of their own). Built and merged with #104 on 2026-10-04.
- **Date:** 2026-09-18, amended 2026-09-18, 09-22, 09-24 and 09-25
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
terpcontrol.com sets it, and is now "Nebel", described [below](#the-look-nebel).

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

### The look: "Nebel"

The app wears "Nebel" (Chris, 2026-11-13): a warm paper under navy ink, one light sans, and the brand's green for
the one primary action. `webapp/src/theme/tokens.css` is where every value below is written; this section says
what they are and why, and the two change together. The page's structure - the frame, the wide layouts, the shared
layer in `webapp/src/ui` - is not part of the look and did not change with it.

**It supersedes the brand look**, which this section recorded from 2026-09-24: Inter in bold titles and semibold
figures, the site's cool white and blue-grey, its brand blue for whatever is selected and tracked capitals over
every section. Chris found its type heavy - bold everywhere, nothing fine - and its colours neither soft nor in
tune with one another, and asked for a look that still follows the brand but is more modern. From three proposals
he chose this one, and decided the same day that the one primary action keeps the brand green where the proposal
had made it navy. What stays from the looks before: no serif anywhere (Chris, 2026-09-24), no monospaced face on
figures, and the brand's own logo and green. What his choice overrules: the warm paper, which the brand look had
ruled out, and following the site's palette value for value. The values other than the direction itself - the
signal colours, the lamp's, the weights, the radii - were worked out by the redesign session of 2026-11-13 and
are open to him.

**Face.** One family, OFL, self-hosted: **Albert Sans Variable** (`@fontsource-variable/albert-sans`, the weight
axis). It has no tabular figures - its "1" is half as wide as its "0" - so a column of readings would not line up
and a live figure would push its unit about as it changes. `webapp/scripts/tabular-digits.py` therefore cuts
digits of one width out of it: 0-9 only, each centred on the width of its weight's "0" - except the "1", which
has an advance of its own, seven tenths of a zero's (Chris, 2026-11-13: centred on a whole zero it left a hole on
either side, "1 1,1", in a column and a stepper; at seven tenths a column stays within a few pixels of flush) -,
as three static faces of about 1.3 KB (`src/theme/albert-sans-tabular-digits-{300,400,500}.woff2`) - static, because recentring moves an
outline differently at every weight. `--font-figure` names that face ahead of Albert Sans: digits are a digit
wide, everything else keeps its own width. **It is for figures that stand under one another or change in place**
- a table's column, an axis, a list's time column, a stepper's value, a countdown, Verlauf's cursor line - and for
nothing else (the redesign session of 2026-11-13, after the whole-app walk): the cut "1", centred on a zero's
width, left a hole on either side, which in a large light figure read "60, 1 %" and in a date "1 3.1 1.2026". A
sentence, a date, a chip, a title and a figure that stands alone - a tile's, the picture's, a panel's head - are
set in the face's own digits; app-ux.md §9 lists the uses. The server draws its overlays in the same family:
`server/scripts/install-fonts.mjs` unpacks `@fontsource/albert-sans` at 400 and 500 into the image for librsvg.

**Hierarchy** comes from size and a lighter weight, never from a second family and never from bold. There are
three weights: 300 for a page's title and for figures, 400 for text and for a thing's name, 500 (`--weight-medium`)
for what is stressed - a button's words, a value in a row, a chosen tab. Nothing is set heavier: what a browser
sets bold by itself - `b`, `strong`, `th`, `h3`, `h4`, `optgroup` - is brought to the medium in `global.css`, and
a weight is only ever one of the tokens (`test/weights.test.ts`; Düngung's product names had fallen to a `th`'s
700). A page's title is
300, closed up by -0.025 em, in `--heading`; a name and a section's heading (`h2`, `.name`) are 400 at -0.01 em in
the same ink. In a region dimmed by age the heading ink steps down with the rest of the ink.

**Scale** (px): 11.5 for the caption under a bar's icon and the smallest note; 12.5 / 13.5 / 15 / 17 / 22 for text
(`--text-xs` to `--text-xl`, 15 is body); names on cards 17 on a phone and 18 on a desktop; page titles 30 and
36; the big card figure 30 and 34 - light, so that temperature, humidity and VPD with their units still fit one
line of a 390 px phone card. Body line height is 1.5, tight lines 1.2.

**Section labels** are small, regular and in sentence case: 12.5 px in the label colour. Nothing in the app is set
in capitals. A `header` whose first child is a `.label`, or a label straight inside a `section`, stands on a
hairline rule.

**Palette.** The colours are tuned to one another rather than set side by side, and each was worked out in OKLCH
(lightness, strength, hue) before it was written down in hex, which a chart's canvas reads:

- **Surfaces are one hue** (a warm grey, hue 95, strength under 0.01): the page, a card a breath lighter, an inset
  surface a breath darker, the rules darker again. In dark mode they are a near-black with a breath of the navy
  (hue 262), and the ink is the paper.
- **Ink and whatever is chosen are one navy** (hue 262): text, headings, links, the focus ring, and the wash and
  ring of a chosen chip or segment - the same marks in both modes, so a row of choices is quiet.
- **Green is the brand's.** The one primary action is filled with the brand green `#3e8024` under white words in
  both modes (4.9:1), the one strong colour a screen has. The soft greens for "good" - live, in band, how far a
  grow has come - sit on that green's hue (140) at a lower strength, so the two are one family; as text the soft
  green takes `--green-ink`.
- **Signals share one lightness and nearly one strength and differ by hue**: temperature a terracotta (hue 45),
  humidity a sea blue (225), CO₂ a mauve (320), a warning an ochre (78), an alarm a brick red (22) - at about
  0.53 for the curves and 0.50 for the two that are mostly words in light mode, 0.78 in dark. No curve shouts
  over another, and each still reads as text.
- **The lamp has its own light**, a straw (`--lamp`), on a timeline lane and behind a lit day: until this look
  it borrowed the warning's colour, and a lamp that is on is not a warning. It is lighter and yellower than the
  warning in both modes - oklch(0.72 0.12 88) in light, 2.4:1 on a card where the first value was 1.8:1 and the
  faintest mark on Verlauf (kept at that by Chris, 2026-11-13: darker drifts toward the warning's ochre); oklch(0.86 0.10 95) in dark, where the first value had been the warning's very own
  (the redesign session of 2026-11-13, after the whole-app walk).

Every text colour clears WCAG AA on the page, the card and the inset surface of its own mode, computed for each
pair: the lowest are the three curve colours read as text on the inset surface, 4.5:1, and the secondary ink,
5.2:1; the soft green as a surface is 3.4:1 on a card.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--bg` | `#f6f4f0` | `#14161a` | the page |
| `--card` | `#fdfcfa` | `#1d1f24` | cards, sheets |
| `--card-2` | `#f0eee9` | `#24282e` | inset surfaces, fields, quiet actions |
| `--rule` | `#e4e3dd` | `#2d3037` | hairlines |
| `--rule-strong` | `#d3d1ca` | `#44484f` | a field's edge, a dashed outline |
| `--control-edge` | `#7a818d` | `#808693` | an off switch's edge, 3:1 on a card |
| `--ink` | `#212938` | `#e9e8e3` | text |
| `--muted` / `--label` | `#5d646f` | `#adaba3` | secondary text, labels, captions |
| `--heading` | `#192437` | `#f3f2ee` | titles and names |
| `--brand` | `#395487` | `#afc5ec` | the current item, links, focus, a secondary button's words |
| `--on-brand` | `#fbfaf7` | `#161b24` | text on the navy |
| `--brand-wash` | `#e4ecf9` | `#242e40` | behind whatever is selected |
| `--selected` / `--selected-edge` | the wash / `#90a5cb` | `#242e40` / `#6d81a5` | a chosen chip or segment: fill and ring |
| `--on-selected` | the ink | `#f3f2ee` | text on a choice |
| `--green` | `#65955a` | `#95c78a` | live dots, in-band marks, reached segments, a grow's progress |
| `--green-ink` | `#34582c` | `#acd9a2` | green text |
| `--green-wash` | `#e3f2e0` | `#243221` | behind a green word: live, a stage, the current step |
| `--green-fill` / `--on-green` | `#3e8024` / `#ffffff` | the same | the primary action's fill and its words |
| `--alarm-fill` / `--on-alarm` | `#a03f40` / `#ffffff` | the same | the yes to a step that cannot be taken back: its fill and its words |
| `--temperature` | `#a25834` | `#e8a587` | terracotta |
| `--humidity` | `#33738b` | `#8ac1d7` | sea blue |
| `--co2` | `#865d8f` | `#cda8d6` | mauve |
| `--warning` | `#7f5c1d` | `#dfc07f` | ochre, for what is actually wrong |
| `--alarm` | `#a03f40` | `#ea9794` | brick red |
| `--warning-wash` / `--warning-edge` | `#f9f0da` / `#dfc07f` | `--card-2` / `#b89a5a` | a warning's ground and edge |
| `--alarm-wash` / `--alarm-edge` | `#fceae8` / `#ecb4b1` | `--card-2` / `#c87976` | an alarm's ground and edge |
| `--output` | `#6981ab` | `#90a5cb` | what an output did: lanes, output lines |
| `--lamp` | `#c4a040` | `#e5d183` | the lamp's light on a lane and a lit day |

Rules that hold from the looks before: **a warning's ground and edge are written out**, not mixed from the signal
into a surface, and in dark mode a warning stands on the lifted surface and lets its edge and ink say the rest;
**an output running is not a warning**, so lanes and output lines take the light navy; sliders and an on switch
take the soft surface green. A pressed series chip is filled with its line's colour in light mode and is the
chosen wash with a mark of the line's colour in dark mode.

Captions over photographs sit on smoked glass (`--overlay`, text `--on-overlay`) in both modes, because the
picture does not change with the theme; a button over a photograph is solid (`--overlay-solid`). The toast is the
deep navy in light mode and a raised surface in dark. The page has no glow. The sign-in and sign-up cards stand on
`--spotlight` - the navy at its deepest with the brand green's light in one corner - in both modes.

**The logo** is the brand's own, `public/assets/brand/logo.png`, in the rail, the phone's top bar, the sign-in
and sign-up cards, the public pages' bar and the error page, in place of a typeset name. The phone's top bar shows
the logo's shield on every page, the rail the whole logo (the redesign session of 2026-11-13: the bar showed the
shield beside the place chip and the wordmark, with a tagline about 4 px high, elsewhere). A share link's card
carries the reverse logo in its top corner (Chris, 2026-11-13; `server/src/modules/v1/sharing/brand-mark.ts`,
embedded because the image ships only `dist`), and its scrim is dark at the top too, so the logo reads over a
bright photo. On a dark surface it is
`logo-reverse.png`, which is derived from the colour logo by `webapp/scripts/derive-logo.mjs` rather than
retouched: per pixel, how much of the logo's blue it holds becomes white, how much of its green keeps its own
colour, and the logo's white drops out so the dark ground shows through the knockouts. A `Logo` component draws
both and `--logo-colour` / `--logo-reverse` say which one shows, so it follows the theme. The favicon and the
installed app's icons are the logo's shield.

**Charts** take every colour from these tokens through `src/charts/tokens.ts`: a line in its signal colour (VPD
and hand-written readings in ink, outputs in `--output`), the target band `--band` (the soft green at 16 %), the
nights `--night` as a faint wash of the ink (black in dark mode), halved over a long range so a month of nights
does not read as a barcode, and three faint rules across each plot in `--grid`. A series chip and the pinned
reading's stroke are the legend. The server's timelapse overlays and share-link cards use the dark palette's ink,
muted ink, ground and signal colours, in Albert Sans at 400 and 500. An overlay writes its figures as the app does
for the owner - the owner's language and decimal mark, the app's decimals ("25,6 °C") - and draws its curve inside
its box, the caption bar as wide as the box; a share card and the page around it are in the owner's language.

**Icons** are drawn with a fine line: every lucide icon at a stroke of 1.5 (`svg.lucide` in `global.css`), as the
type is light.

**Shape.** Three soft radii: 12 px for a control (a button, a field), 18 px for a card and a rail item, 24 px for
a large panel; 8 px for the option inside a segmented track. A chip that is a choice, a tag, the live pill and a
badge are pills. 1 px rules; under a card in light mode a low, wide shadow in the paper's own hue
(`0 1px 2px rgb(49 46 34 / 5%), 0 12px 28px -18px rgb(49 46 34 / 20%)`), raised things a larger one; in dark mode
a card has no shadow and a raised thing a deep one. A field is 44 px tall, a card's repeated action 36, a chip 30.
The one primary action on a screen is filled green; the quieter actions a card repeats (Photo, Note, Alarms off)
are a filled tint with no outline; everything else is a ghost button - the card's surface, its words in the navy,
a hairline edge. **One danger style** (the redesign session of 2026-11-13, after the third critic found four): the
yes to a step that cannot be taken back - removing a member, a place or a socket, giving a device up, switching
regulation off, deleting an alarm, a scheme, a build or the account - is filled with `--alarm-fill` under white `--on-alarm` (6.4:1) in both
modes, never the brand green, and is armed in one step; it is the yes of the shared `Asking` with `danger`
(`.dangerFilled`, `ui/ui.module.css`). Every question's yes - danger, primary or quiet - stands with
"Abbrechen" beside it in one part, `Answer` (`ui/Asking.tsx`), at a control's 44 px and 12 px radius (the redesign
session of 2026-11-14). The control that opens such a question is outlined in the alarm red (`.dangerOutline`), and
nothing else is; a yes
that waits for something typed (the handle before deleting the account) looks like a primary that cannot be
pressed. A dotted term (`Term`, `ui/Help.module.css`) is a box of its own, 9 px of room above and below its words
held out of its line by a margin as deep, so it is a finger's target without growing its line; a page's row of
tabs fits from 320 px and has no veil at its edge (the redesign session of 2026-11-14). A switch is drawn 42×24 and
tapped as 44 px both ways, its target its own (`.switch::after`), so no page adds one (the third whole-app walk).

**Spacing.** A 4 px unit: 4, 8, 12, 16, 24 and 36 inside a page, 48 and 64 between the sections of a long one;
a card's padding is 16 on a phone and 20 from 900 px.

**Layout.** Phone first, with a frosted top bar and tab bar; from 900 px the rail replaces both and every
screen, a reading page as much as a wide one, is centred in the space it leaves (Chris, 2026-11-13; reading pages
had stood at the frame's left edge so titles would not jump between pages). The rail is a card's surface with a rule down its right edge, its items
in ink and the current one in the navy on its wash - the same marks the phone's bar uses. Three widths: 560 px for
a form or sheet, 760 px for a reading column (settings, lists, Me, Tasks, Alerts), and 1180 px for a page that
uses the screen - Home (two columns of cards from 1200 px, the two of a row stretched to one height with their
actions at the foot), a space's overview, its Timeline, a grow's weeks and feeding chart, and a camera.

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
