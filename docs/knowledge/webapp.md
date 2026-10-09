---
summary: The web app's technology - layout of webapp/, routes, build and dev server, the shared contract, API client and session (401 vs unreachable), charts, media URLs, PWA and push, lint and tests, device data and leftovers to expect; read before changing webapp/
updated: 2026-10-09
source: Chris (PR reviews and sessions 2026-08..10); React rewrite sessions 2026-09..10 (#104, merged 2026-10-04) and follow-ups to #143; codebase cleanup (2026-10-08); checked against webapp/ on 2026-10-08
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
| `src/api/` | one module per resource with its TanStack Query hooks and query factories; plumbing: `client.ts`, `session.ts`, `clock.ts`, `read.ts`, `write.ts`, `pages.ts`, `problem.ts`, `config.ts`, `query-client.ts` |
| `src/ui/` | shared primitives (`Sheet`, `Switch`, `Asking`, `BackLink`, `Help.tsx`, `advanced/`) and one-place helpers (`zone.ts`, `days.ts`, `wall-clock.ts`, `age.ts`, `figures.ts`, `units.ts`, `naming.ts`, `stored.ts`, `session-access.ts`, `refusal.ts`) |
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
  query (`space`/`grow`, `range`, `zoom`, `show`, `layout`, ...), read and written only in
  `src/screens/charts/address.ts`, through which `app/old-charts.ts` maps old bookmarks too.
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
- `vitest.config.ts` and `vitest.live.config.ts` spread `shared` from `vite.config.ts` (the `__APP_VERSION__` define
  and the `@` alias): a new define or alias goes there, or the tests compile differently from the app -
  `npm run test:live`, which CI does not run, once broke that way.
- `webapp/nginx.conf`: `index.html`, `sw.js` and `registerSW.js` are `no-store`; hashed `*-<8 chars>.js|css|woff2`
  are immutable; `/assets/` is `no-cache`, because those names stay the same across releases.

### The shared contract

- Types only from `@fg2/shared-types/v1`, imported type-only (`verbatimModuleSyntax`, lint rule
  `consistent-type-imports`), so the package never reaches the bundle. Runtime values only from the schema-less
  modules `@fg2/shared-types/v1-schemas/<module>.js`; never the index or a module with schemas, which pull in zod.
- A schema-less module names zod and the contract's schemas with `import type` only (`import type { z } from 'zod'`),
  which compiles away; a value import makes it a module with schemas. At runtime it may import another schema-less
  module (`day-night.ts` reads `configuration-fields.ts`). The simulator loads them too
  ([testing.md](testing.md#the-simulator-beyond-claudemd)).
- **Every such module must be listed in `optimizeDeps.include` in `vite.config.ts`.** They are CommonJS written by
  `npm run generate`; an unlisted one makes the dev server hand the browser a module without named exports - a
  blank page - while the production build and `npm test` pass. After adding one, open a screen on the dev server.
- The `followContract` plugin in `vite.config.ts` keys Vite's pre-bundle cache on a hash of
  `shared-types/v1-schemas/*.js` and restarts a running dev server after a generate; before it, a dev server left
  running served the previous contract.
- A value both sides need is defined once in `shared-types/src/v1/` and used by server and app (Chris, 2026-10-06,
  after drying was missing from the work-mode picker because the modes were defined twice): e.g. `WORK_MODES` /
  `workModesOf`, `VALUE_AGE` and `heardAt` (`value-age.ts`), the VPD formula (`vpd.ts`), the climate presets,
  `CAPTURE_FAILURES`, quiet hours and alarm routing (`alert-routing.ts`), the plan step clock (`plan-clock.ts`), the
  steered metrics and bands (`steering.ts`).

## API client and reads

- `src/api/client.ts` is the only way to call the API: it attaches the bearer token, retries a 401 once behind a
  fresh token, turns every failure into an `ApiError` carrying the problem document (`fieldErrors` for forms) and
  aborts each attempt after 30 s - a server that accepted and never answered held screens in "refreshing". Only
  `src/api/` imports it, and every query key lives there: a read used in several places is a query factory
  (`devicesQuery`, `camerasQuery`, ...), so a second key cannot split the cache.
- A list in a query goes out as its name repeated (`metrics=a&metrics=b`), as the series routes read it
  (`test/client.test.ts`); `/entries` takes `kinds` as one comma-joined string, so its callers join that list.
- Query defaults (`query-client.ts`): `staleTime` 30 s, refetch on window focus, no retry below status 500, two
  retries otherwise. Reads of what devices report refetch on `LIVE_BEAT_MS` (30 s, `src/api/read.ts`); the shell's
  shape reads spread `FOLLOWED` (no beat) over the screens' query factories and so share their cache entries.
- Writes are `useWrite` / `useWriteSettled` (`src/api/write.ts`): what `then` returns is what `mutateAsync` waits
  for, so return the `invalidate(...)` to finish only once the re-reads are back.
- Every read goes through `useRead` / `useReadPages` (`src/api/read.ts`): a read that failed once is no longer a
  first load (`hasFailed`, `isFirstLoad`, via `errorUpdateCount`, which survives the retry that clears the error),
  and the last error is kept to tell a 404 from a dropped connection. What a screen then says: app-ux.md §3.
- To keep the last good answer drawn: `placeholderData: keepPreviousData`, and where a refetch fails, read the last
  answer back out of the query cache (`held` / `lastOf` in `src/api/charts.ts`). `lastOf` takes any answer cached
  under `['grow'|'space', id, 'series']`, so a read of the same route that asks for less needs a key of its own
  (`'measurement-series'`). The lint rejects the obvious alternatives: a ref read or written during render
  (`react-hooks/refs`) and setState in an effect (`react-hooks/set-state-in-effect`).
- `noLongerThere()` (`problem.ts`) is the 404 test: `access()` answers 404 to a reader who may not see a subject and
  403 to a refused write. Not every 404 is a subject gone: `GET /v1/devices/{id}/plan` answers 404 `plan_not_found`
  for a device that runs no plan (`isMissing`, `src/api/plans.ts`). Refusals are worded by `refusalText()`
  (`src/ui/refusal.ts`). `readProblem()` makes up code `unexpected` when a proxy answers HTML, so key on the HTTP
  status where it matters (sign-in's 429).
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
- **The query cache belongs to one account.** Query keys carry no user (`['home']`, `['me']`), so the store empties
  the cache whenever the account it holds answers for changes or ends - sign-out, a 401 on the refresh, a sign-in or
  the demo over another account, a restore that brings back someone else's stored session - and never on a refresh
  or an unreachable server. Before this, a second account signing in in the same tab saw the first one's places,
  bell and address until each query went stale. `RequireSession` keys the shell by `user.id`, because opening the
  demo from the home replaces the session without passing `/sign-in`: an observer mounted over a cleared cache
  keeps drawing what it held, and the Log sheet's lines would be retried with the demo's token.
- `queryClient.clear()` under a mounted observer whose fetch is in flight cancels that fetch silently and leaves the
  observer pending until its component re-renders (checked against TanStack Query 5.103). So a cache that held no
  session's answers is not cleared: a stored session refused at boot on `/g/:slug`, whose read waits on that very
  refresh, could otherwise leave the public grow loading.
- The demo is `POST /v1/sessions/demo` and has no account: account routes (`/v1/me` and its kin) answer 403
  `no_account`, so account reads are gated - `useAccountMe()` in `src/api/account.ts` - and
  `src/ui/session-access.ts` answers `view` for it in every place, so it is offered no write. Public pages fire no
  session-bound read for a stranger or the demo; only a signed-in reader's Follow reads its follows.
- Access in a place is the server's `space.youMay`, read through `src/ui/session-access.ts` (`useMayInSpace`,
  `useMayManage`, `useMayLogIn`, `useMayWith`, ...); never derive it from owner ids. What to draw for which role:
  app-ux.md §5.
- Browser storage holds per-browser conveniences only (`terp.language`, `terp.theme`, `terp.place`,
  `terp.shape.<user>`, `terp.lightHold.<device>` - the last light hold sent, since no device reports one back -
  ...); whatever has to follow the account (zone, diary layer, notices seen, the language for text the server
  writes) lives in `me.preferences`. `localStorage` is read and written through `src/ui/stored.ts`, which answers
  null and keeps nothing where storage is blocked; only `src/api/session.ts` has its own, as it uses
  `sessionStorage` too.

## Charts

- ECharts through `echarts/core`, with the pieces drawn registered in `src/charts/Chart.tsx`; a new chart type is a
  line there. The binding is an effect, a `ResizeObserver` and `dispose`, and redraws when `data-theme` or the
  system scheme changes. Colours come from `src/charts/tokens.ts`, which reads the CSS variables - a canvas cannot.
- ECharts' own axes are hidden (`src/charts/series.ts`); the figures app-ux.md §7 asks for are DOM around the plot
  (`screens/charts/ChartCard.tsx`, the Timeline's panels). The cursor is an HTML overlay - `useScrub` in
  `src/charts/scrub.ts`, on Charts and the Timeline alike (only Charts passes `onSelect`) - so a chart is drawn
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
- A new release takes over at once. `src/sw.ts` calls `skipWaiting()` and `clients.claim()` itself - the plugin adds
  them only to a generated worker, and `registerType: 'autoUpdate'` does nothing without them: until October 2026 a
  release waited for every window of the app to close, so an installed app or a tab left open kept the old one
  until somebody emptied the browser's cache. `followReleases()` (`src/app/update.ts`, from `main.tsx`) reloads the
  page once when a new worker claims it - not when the very first one does - and asks for an update whenever the app
  comes back to the front, since a page that never navigates never looks. The injected `registerSW.js` only
  registers the worker. Check it on two builds in a real browser (the browser pane refuses service workers):
  load one, build again with another `VITE_API_URL`, bring the page to the front, and it must reload once onto the
  new bundle.
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
- Copy through `useCopied()` (`src/ui/clipboard.ts`): it falls back to `execCommand` where `navigator.clipboard` is
  missing (plain HTTP) and answers `copied` or `failed` for the button to say.
- Webhook templates (`src/screens/control/alarms/webhook-templates.ts`: Home Assistant, Discord, Telegram, ntfy)
  only fill in a plain webhook. A stored rule is recognised again (`templateOf(rule).read`), so editing one field
  keeps the others - rebuilding from an empty draft once wiped a Telegram bot token. A template sets the tunnel
  itself: Home Assistant goes through the device when its address is at home (`isLocalAddress`), the public services
  never.

## Lint and tests

- `eslint.config.mjs` is the server's flat config plus `react-hooks` 7 `recommended-latest`, which carries the React
  Compiler's rules (`refs`, `set-state-in-effect`, `purity`, ...) although the compiler does not run in the build,
  and `react-refresh/only-export-components`. Prettier reads the one `.prettierrc` at the repository root, as the
  server does. `tsconfig.json` is `strict`: the contract spells "none" as `null`.
- Vitest in jsdom (`vitest.config.ts`; `test/setup.ts` stubs `ResizeObserver`). Tests share their helpers rather than
  define their own: `test/session.ts` the sessions (`SIGNED_IN`, `ON_THE_DEMO`, `SIGNED_OUT`, `meWith`,
  `spaceWhere(youMay)`), `test/fixtures.ts` a device (`deviceWith`), `test/harness.tsx` the drawing (`drawAt`,
  `testClient`, `json`, `NOT_FOUND`), `test/translations.ts` the shipped catalogues (`catalogue`, `translate`). Screen
  tests mock `@/api/session` and stub `fetch`. Off a terminal only failures are printed, and console output from a
  passing test is a fault to fix. `npm run test:live` (node environment) signs in with `AGENT_TESTING_*` from the root
  `.env` against a running stack.
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

Its addresses still work (see Routes), and its catalogues keep the keys a screen reads and every `message-*` key,
which devices and the server store. Its browser storage (`id_token`, `refresh_token`, `image_token`, `user`) is not
read.
