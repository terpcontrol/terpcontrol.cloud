---
summary: The web app's technology - layout of webapp/, routes, build and dev server, the shared contract, API client and session (401 vs unreachable), charts, media URLs, PWA and push, lint and tests, device data and leftovers to expect; read before changing webapp/
updated: 2026-10-08
source: Chris (PR reviews and sessions 2026-08..10); React rewrite sessions 2026-09..10 (#104, merged 2026-10-04) and follow-ups to #143; checked against webapp/ on 2026-10-08
paths:
  - webapp/**
---
# The web app

`webapp/` is the React app that replaced the Angular/Ionic one (#104, merged 2026-10-04). This is how it is built
and what to know before changing it. Times, dates, numbers and translations have their own document,
[webapp-time-and-language.md](webapp-time-and-language.md). Elsewhere: the library choices and the brand look in
[ADR 0002](../adr/0002-app-rewrite-frontend-stack.md); how the app must behave and look in [app-ux.md](app-ux.md),
its words in [app-wording.md](app-wording.md); running it in README "Development" and `CLAUDE.md`; the API in
[server.md](server.md); tests in general in [testing.md](testing.md), CI in [ci-and-release.md](ci-and-release.md);
rules learnt during the rewrite in [app-rewrite-handover.md](../app-rewrite-handover.md).

## Layout

| Path | What |
| --- | --- |
| `src/main.tsx` | keeps the install prompt, loads the catalogues, renders |
| `src/app/` | `routes.tsx`, `shell/` (bars, rail, notices), `RequireSession.tsx`, `OldAddresses.tsx` + `old-charts.ts`, `places.ts` (deep links), `install.ts` |
| `src/api/` | one module per resource with its TanStack Query hooks; plumbing: `client.ts`, `session.ts`, `clock.ts`, `read.ts`, `problem.ts`, `config.ts`, `query-client.ts` |
| `src/ui/` | shared primitives and one-place helpers (`zone.ts`, `age.ts`, `figures.ts`, `session-access.ts`, `refusal.ts`, `Help.tsx`, `advanced/`) |
| `src/log/` | the Log sheet, its send queue and undo toasts, `corrections.ts` |
| `src/charts/`, `src/i18n/` | ECharts binding and chart arithmetic; i18next setup and device-message resolver |
| `src/theme/`, `src/styles/`, `src/sw.ts` | `tokens.css`, `ThemeProvider`, `global.css`; the service worker |
| `public/` | manifest, icons, catalogues `assets/i18n/`, feeding schemes `assets/schemes/` |
| `test/`, `test/live/` | Vitest suites; the live ones need a running stack |

## Routes and addresses

- `src/app/routes.tsx`: the public routes (sign-in/up, recover, activate, `/privacy`, `/g/:slug`, `/shared/:token`,
  `/join`, `/:handle`) sit outside `RequireSession`, so a stranger never meets the sign-in page. `/g/:slug` and
  `/:handle` restore a stored session themselves, only to offer a signed-in reader Follow; `/shared/:token` restores
  none and draws no Follow. `/@handle` is routed as `/:handle` (React Router reads a parameter only after a
  slash) and ranks below every named route.
- Deep links come from `src/app/places.ts`: a place is `/spaces/:id`; Verlauf and Steuerung carry the place in the
  query (`/timeline?space=&focus=&at=`, `/control/<targets|alarms|plan>?space=`); Charts keeps its whole view in the
  query (`space`/`grow`, `range`, `zoom`, `show`, `layout`, ...).
- The old app's addresses still work (`OldAddresses.tsx`, `old-charts.ts`, redirects at the end of `screens`):
  `/login?recovery=|?code=` from old mails, `/demo` (website buttons; a signed-in user goes straight in), `/list`,
  `/account`, `/shares`, `/diagnostics`, `/device/<id>/<page>` (the same page of the device's place) and old chart
  bookmarks. Old share links (`?share=`) and `/link-expired` say the link ended.
- nginx answers every path with `index.html`; the `*` route renders NotFound under the typed address.

## Build, configuration, dev server

- `npm run start:public` (`vite --mode public`) listens on all addresses and accepts any host name
  (`allowedHosts: true`) - the wildcard Chris asked for instead of a hardcoded host (#104 review, done in #133). It
  switches off Vite's DNS-rebinding guard, which is why plain `npm start` does not.
- The build-time configuration is read in `src/api/config.ts`. `VITE_API_URL` is compiled in: `scripts/set-env.mjs`
  (pre-hook of every start, dev, build and test:live script) writes `webapp/.env.local` from the root `.env`'s
  `API_URL_EXTERNAL`, and leaves a `.env.local` alone whose generated first line was deleted. The image turns the
  build args `API_URL_EXTERNAL`, `CUSTOM_LINKS_HTML` (an install's own links under the sign-in form, as HTML) and
  `PRIVACY_URL` (empty: sign-up links the app's own `/privacy`) into `VITE_API_URL`, `VITE_CUSTOM_LINKS_HTML` and
  `VITE_PRIVACY_URL`.
- `webapp/nginx.conf`: `index.html`, `sw.js` and `registerSW.js` are `no-store`; hashed `*-<8 chars>.js|css|woff2`
  are immutable; `/assets/` is `no-cache`, because those names stay the same across releases.

### The shared contract

- Types only from `@fg2/shared-types/v1`, imported type-only (`verbatimModuleSyntax`, lint rule
  `consistent-type-imports`), so the package never reaches the bundle. Runtime values only from the schema-less
  modules `@fg2/shared-types/v1-schemas/<module>.js`; never the index or a module with schemas, which pull in zod.
- **Every such module must be listed in `optimizeDeps.include` in `vite.config.ts`.** They are CommonJS written by
  `npm run generate`; an unlisted one makes the dev server hand the browser a module without named exports - a
  blank page - while the production build works.
- The `followContract` plugin in `vite.config.ts` keys Vite's pre-bundle cache on a hash of
  `shared-types/v1-schemas/*.js` and restarts a running dev server after a generate; before it, a dev server left
  running served the previous contract.
- A value both sides need is defined once in `shared-types/src/v1/` and used by server and app (Chris, 2026-10-06,
  after drying was missing from the work-mode picker because the modes were defined twice): e.g. `WORK_MODES` /
  `workModesOf`, `VALUE_AGE`, the VPD formula (`vpd.ts`), the climate presets, `CAPTURE_FAILURES`. Open debt:
  `heldBackBy` in `src/screens/control/alarms/rules.ts` copies the server's quiet-hours arithmetic (`heldBack` in the
  notification service); it belongs in `shared-types/src/v1/alert-routing.ts` beside `alertCategory`.

## API client and reads

- `src/api/client.ts` is the only way to call the API: it attaches the bearer token, retries a 401 once behind a
  fresh token, turns every failure into an `ApiError` carrying the problem document (`fieldErrors` for forms) and
  aborts each attempt after 30 s - a server that accepted and never answered held screens in "refreshing".
- Query defaults (`query-client.ts`): `staleTime` 30 s, refetch on window focus, no retry below status 500, two
  retries otherwise. Each read sets its own `refetchInterval` in its api module (home: 30 s).
- Every read goes through `useRead` / `useReadPages` (`src/api/read.ts`): a read that failed once is no longer a
  first load (`hasFailed`, `isFirstLoad`, via `errorUpdateCount`, which survives the retry that clears the error),
  and the last error is kept to tell a 404 from a dropped connection. What a screen then says: app-ux.md §3.
- To keep the last good answer drawn: `placeholderData: keepPreviousData`, and where a refetch fails, read the last
  answer back out of the query cache (`held` / `lastOf` in `src/api/charts.ts`). The lint rejects the obvious
  alternatives: a ref read or written during render (`react-hooks/refs`) and setState in an effect
  (`react-hooks/set-state-in-effect`).
- `noLongerThere()` (`problem.ts`) is the 404 test: `access()` answers 404 to a reader who may not see a subject and
  403 to a refused write. Refusals are worded by `refusalText()` (`src/ui/refusal.ts`). `readProblem()` makes up code
  `unexpected` when a proxy answers HTML, so key on the HTTP status where it matters (sign-in's 429).
- Export zips are served to a session only: `apiBlob()` into a blob and an `<a download>` (`useDownloadExport` in
  `src/api/exports.ts`), since a link cannot carry the bearer header.
- Lifecycle mutations (`src/api/lifecycle.ts`) re-read the grow after the server answers instead of patching the
  cache, because the server works out day counter, stage and placements; the Log sheet's queue
  (`src/log/LogProvider.tsx`) confirms first and sends after.

## Session

`src/api/session.ts` is a store outside React (`useSession()`):

- `POST /v1/sessions` answers a user token (5 min), a refresh token (30 min; 30 days with "stay logged in") and a
  media token (30 days). Only the refresh token is stored, under `terp.session`: `localStorage` with "stay logged
  in", else `sessionStorage` (the demo too).
- The user token is refreshed 30 s before it dies, one refresh in flight for all callers. At boot the stored refresh
  token is always tried; the browser's clock does not judge its expiry.
- **Only a 401 on the refresh ends a session** (`forget(true)`; sign-in then says the session ended). No answer, a
  5xx or a proxy's 502 set `unreachable` and keep the tokens: `RequireSession` shows "cannot reach the server" with
  Try again and a way to the sign-in form, so an outage signs nobody out (Chris already ruled in the old app,
  2025-11, that a failed refresh must not sign out).
- `RequireSession` carries the whole address (`pathname + search + hash`) through sign-in and `SignIn` replays it,
  so deep links keep their subject. Sign-out forgets locally first, then sends `DELETE /v1/sessions/:id`.
- The demo is `POST /v1/sessions/demo` and has no account: account routes (`/v1/me` and its kin) answer 403
  `no_account`, so account reads are gated - `useMe(false, user !== null && user.isDemo !== true)` - and
  `src/ui/session-access.ts` answers `view` for it in every place, so it is offered no write. Public pages fire no
  session-bound read for a stranger or the demo; only a signed-in reader's Follow reads its follows.
- Access in a place is the server's `space.youMay`, read through `src/ui/session-access.ts` (`useMayInSpace`,
  `useMayManage`, `useMayLogIn`, `useMayWith`, ...); never derive it from owner ids. What to draw for which role:
  app-ux.md §5.
- Browser storage holds per-browser conveniences only (`terp.language`, `terp.theme`, `terp.place`,
  `terp.shape.<user>`, `terp.lightHold.<device>` - the last light hold sent, since no device reports one back -
  ...); whatever has to follow the account (zone, diary layer, notices seen, the language for text the server
  writes) lives in `me.preferences`.

## Charts

- ECharts through `echarts/core`, with the pieces drawn registered in `src/charts/Chart.tsx`; a new chart type is a
  line there. The binding is an effect, a `ResizeObserver` and `dispose`, and redraws when `data-theme` or the
  system scheme changes. Colours come from `src/charts/tokens.ts`, which reads the CSS variables - a canvas cannot.
- ECharts' own axes are hidden (`src/charts/series.ts`); the figures app-ux.md §7 asks for are DOM around the plot
  (`screens/charts/ChartCard.tsx`, the Timeline's panels). The cursor is an HTML overlay - `useScrub` in
  `src/charts/scrub.ts` on Charts, its own copy without zoom in `screens/timeline/Timeline.tsx` - so a chart is drawn
  once per answer and scrubbing costs no redraw; on Charts a mouse drag also marks a stretch to zoom into, a touch
  drag only moves the cursor.
- Axis bounds come from `niceScale()` in `src/charts/series.ts`, shared by Charts and Timeline, with both corners
  snapped to the step's decimals: a corner one ULP above a round number (169 × 0.2 = 33.800000000000004) trips an
  ECharts assert that exists only in development builds, i.e. under the dev server.
- Gridlines fall on the account's clock and calendar (`src/charts/ticks.ts`); the window widths are in
  `src/screens/charts/span.ts`.

## Media URLs

- `mediaUrl(id, width?)` in `src/api/session.ts` is the only place a token goes into a URL: `/v1/media/{id}/content`
  with the media token and an optional width in the query. The server shrinks, never enlarges; ask for twice the
  drawn size (`THUMBNAIL_WIDTH`).
- A media URL must stay the same between renders, or the browser downloads the picture again: keep timestamps and
  other changing values out of it. So a refresh keeps a media token with more than a day left (`MEDIA_MARGIN_MS`);
  swapping it on every refresh re-fetched every picture every ~4.5 min, 90 frames per Timeline replay. A sign-in
  never takes over another account's media token.

## PWA, install, push

- Manifest: `public/manifest.webmanifest` (the plugin's own is off). SVG icons first (`assets/icons/icon.svg`,
  `icon-maskable.svg` inside the maskable safe zone), PNGs as fallback; Android caches an installed app's icon, so a
  new icon shows only after a reinstall.
- The service worker is hand-written, `src/sw.ts` (vite-plugin-pwa `injectManifest`), because a generated one has no
  push handler. It precaches the shell (js, css, html, woff2 without the non-latin font subsets) and both
  catalogues, answers navigations with `index.html`, caches `/assets/` stale-while-revalidate once fetched, shows a
  push and opens its target (`src/screens/notifications/push-route.ts`).
- A precache entry without a revision is never fetched again. vite-plugin-pwa leaves the revision off everything
  under `assets/` by default, assuming Vite hashed it - but `public/assets/` (catalogues, help pages) keeps its names.
  Until October 2026 that froze the catalogues at the first release a browser saw: new code, old words, raw keys
  (`cockpit.tile.hourMean`, `operatingMode.drying`). `dontCacheBustURLsMatching` in `vite.config.ts` now exempts only
  hashed names; `grep -o '{"revision":null[^}]*}' dist/sw.js` after a build must list hashed files only.
- `src/sw.ts` calls neither `self.skipWaiting()` nor `clientsClaim()`, which the plugin adds only to a generated
  worker. Despite `registerType: 'autoUpdate'`, a new release therefore takes over only once every window of the app
  has been closed; until then the old precached shell is served (open question 4 in
  [ADR 0002](../adr/0002-app-rewrite-frontend-stack.md#open-questions)).
- The dev server runs no worker (`devOptions.enabled: false`): try push on a build (the image, or
  `npm run build && npm run preview`), in a secure context.
- `catchInstallPrompt()` in `main.tsx` keeps Chromium's `beforeinstallprompt`, which fires once at load, for Me ›
  Appearance to replay. iOS has no prompt and gets the steps; Safari delivers web push only to a web app added to the
  home screen.

## Styling, Erweitert, small helpers

- The theme is the `data-theme` attribute on `<html>` (`ThemeProvider`; `terp.theme` in `localStorage`, absent means
  follow the system), so colours switch in CSS alone; only the chart canvas redraws. Tokens and look: ADR 0002 and
  app-ux.md §9.
- `src/theme/inter-tabular-digits.woff2`, the digits-only face behind `--font-figure`, is cut by
  `scripts/tabular-digits.py`; run it again after upgrading `@fontsource-variable/inter`. `logo-reverse.png` is
  derived from the colour logo by `scripts/derive-logo.mjs`.
- An Erweitert item is a file `*.advanced.tsx` exporting `items` built with
  `advancedItem({ scope, id, order, shows, Item })`, found by `import.meta.glob` in `src/ui/advanced/registry.ts`.
  Scopes: `device`, `place`, `charts`, `camera`. The fast-refresh lint rule is off for these files. Its device
  settings are `Field*` controls (`src/ui/advanced/Fields.tsx`) named as `CONFIGURATION_FIELDS` names them per type
  (`shared-types/src/v1/configuration-fields.ts`, the AIR fan and the LIGHT included), written on the tap through
  `useConfigure` (`PATCH /v1/devices/{id}/configuration` with `set`); a row then shows what the server stored.
- Copy through `copyText()` (`src/ui/clipboard.ts`): it falls back to `execCommand` where `navigator.clipboard` is
  missing (plain HTTP) and says whether it copied.
- Webhook templates (`src/screens/control/alarms/webhook-templates.ts`: Home Assistant, Discord, Telegram, ntfy)
  only fill in a plain webhook. A stored rule is recognised again (`templateOf(rule).read`), so editing one field
  keeps the others - rebuilding from an empty draft once wiped a Telegram bot token. A template sets the tunnel
  itself: Home Assistant goes through the device when its address is at home (`isLocalAddress`), the public services
  never.

## Lint and tests

- `eslint.config.mjs` is the server's flat config plus `react-hooks` 7 `recommended-latest`, which carries the React
  Compiler's rules (`refs`, `set-state-in-effect`, `purity`, ...) although the compiler does not run in the build,
  and `react-refresh/only-export-components`. `tsconfig.json` is `strict`: the contract spells "none" as `null`.
- Vitest in jsdom (`vitest.config.ts`; `test/setup.ts` stubs `ResizeObserver`). `test/session.ts` holds session
  fixtures (`SIGNED_IN`, `ON_THE_DEMO`, `SIGNED_OUT`, `spaceWhere(youMay)`); screen tests mock `@/api/session` and
  stub `fetch`. Off a terminal only failures are printed, and console output from a passing test is a fault to fix.
  `npm run test:live` (node environment) signs in with `AGENT_TESTING_*` from the root `.env` against a running stack.
- Tests that read the source or the assets: `zone.test.ts`, `figures.test.ts`, `help.test.tsx`,
  `device-message.test.ts` (see [webapp-time-and-language.md](webapp-time-and-language.md)) and `schemes.test.ts`
  (the feeding schemes in `public/assets/schemes/` against the contract, `flipWeek` = first flowering week; they are
  maintained with the `feeding-schemes` skill).

## Device data a screen must not assume

- `Device.type` is an open string: never filter by a list of known types where all devices are meant. Hardware of a
  type this build does not know stays listed and readable (its alarm rules too) and is offered nothing type-specific.
- `device.configuration` is `null` until the device has sent its settings (current firmware on every connect, older
  firmware only after a change on its own menu); `device.control` is `null` for plug, light and fan;
  `device.state.hardware` is the raw hardware report (e.g. `ppfd: 'on'`).
- Decide what a screen shows from these facts of the device itself, not from flags handed down or stored profiles
  (Chris, 2026-06-30, against a `hideFanSettings` prop in the old app).
- Migrated data: grows carry no plant list, `lastSeenAt` is older than the truth, accounts sit on UTC until
  adopted, and machine lines may carry no key ([data.md](data.md) has the legacy shapes).

## Left behind by the Angular app

Its addresses still work (see Routes) and its catalogues were kept. Beyond that:

- The catalogues still carry its keys that no screen reads - `settings.*`, `devices.fridge.recipe.*`,
  `devices.maintenance.*`, `demo.saveNotSupported` and more - in words [app-wording.md](app-wording.md) retires
  ("Rezept", "Wartungsmodus"): grep `src/` before taking a key as live.
- Its browser storage (`id_token`, `refresh_token`, `image_token`, `user`) is not read.
- `public/assets/` still holds files nothing in `src/` references: the onboarding videos in `wizard/` (~29 MB), the
  device icons in `icon/` (only `favicon.png` is used), `imgs/`, store badges, old logos, `i18n/help/` and
  `mwversion.json`.
