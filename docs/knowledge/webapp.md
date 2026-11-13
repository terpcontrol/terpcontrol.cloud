---
summary: The web app's technology - layout of webapp/, routes, build and dev server, the shared contract, API client and session (401 vs unreachable), charts, media URLs, PWA and push, lint and tests, device data and leftovers to expect; read before changing webapp/
updated: 2026-11-13
source: Chris (PR reviews and sessions 2026-08..10); React rewrite sessions 2026-09..10 (#104, merged 2026-10-04) and follow-ups to #143; codebase cleanup (2026-10-08); checked against webapp/ on 2026-10-08; navigation redesign, bar, addresses, chosen place and Start (2026-11-12); the build dropping `backdrop-filter`, found on a built bundle (2026-11-12); Steuerung, device and camera pages, shared rows and page head (the redesign session of 2026-11-12); the one save path, pages by device, the arrow that steps back and the toasts after that session's critic's walk (2026-11-12); Verlauf as one page, its address, the plot and its gestures (the redesign session of 2026-11-12); where the toasts stand while a sheet is open, and the one name of an alarm rule (the same session after its critic's second walk, 2026-11-12); Verlauf's walk and its fixes (the redesign session of 2026-11-12)
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
| `src/app/` | `routes.tsx`, `shell/` (bars, rail, the choice of place, notices), `RequireSession.tsx`, `OldAddresses.tsx` + `old-charts.ts`, `places.ts` (deep links, the chosen place), `install.ts` |
| `src/api/` | one module per resource with its TanStack Query hooks and query factories; plumbing: `client.ts`, `session.ts`, `clock.ts`, `read.ts`, `write.ts`, `pages.ts`, `problem.ts`, `config.ts`, `query-client.ts` |
| `src/ui/` | shared primitives (`Sheet`, `Menu`, `Lines`, `Rows`, `PageHead`, `OfflineHelp`, `Switch`, `Asking`, `BackLink`, `Help.tsx`, `advanced/`) and one-place helpers (`zone.ts`, `days.ts`, `wall-clock.ts`, `age.ts`, `figures.ts`, `units.ts`, `naming.ts`, `stored.ts`, `session-access.ts`, `refusal.ts`) |
| `src/log/` | the entry sheet, its send queue and undo toasts, `corrections.ts`, the moment a line is dated to (`Moment.tsx`, EXIF in `taken-at.ts`) |
| `src/charts/`, `src/i18n/` | ECharts binding, a plot as data, the gestures of a plot, the time axis; i18next setup, the device-message resolver and what an alarm rule is called (`ruleTitle`, `alarm-line.ts`) |
| `src/theme/`, `src/styles/`, `src/sw.ts` | `tokens.css`, `ThemeProvider`, `global.css`; the service worker |
| `public/` | manifest, icons, catalogues `assets/i18n/`, feeding schemes `assets/schemes/` |
| `test/`, `test/live/` | Vitest suites; the live ones need a running stack |

## Routes and addresses

- `src/app/routes.tsx`: the public routes (sign-in/up, recover, activate, `/privacy`, `/g/:slug`, `/shared/:token`,
  `/join`, `/:handle`) sit outside `RequireSession`, so a stranger never meets the sign-in page. `/g/:slug` and
  `/:handle` restore a stored session themselves, only to offer a signed-in reader Follow; `/shared/:token` restores
  none and draws no Follow. `/@handle` is routed as `/:handle` (React Router reads a parameter only after a
  slash) and ranks below every named route.
- The pages behind the session, and the item of the bar marked on each (`src/app/shell/tabs.ts`):

  | Address | Page | Bar item |
  | --- | --- | --- |
  | `/` | Start: the one place, the places by room, or the empty Start | Start |
  | `/spaces/:spaceId` | Start of one place | Start |
  | `/spaces/:spaceId/edit`, `.../remove`, `.../members` | "Ort bearbeiten", which the ⋯ on Start opens; "Ort entfernen" under it; who is let in, for a member who may not manage the place (whoever may is sent to `edit`) | Start |
  | `/grow/:tab?` | the grow running in the chosen place - its diary, and `pictures`, `plants`, `feeding`, `report` - else the offer to start one | Grow |
  | `/grows`, `/grows/new`, `/grows/:growId/:tab?`, `.../plants/:plantId`, `.../measurements` | every grow ("Alle Grows"); one grow with the same tabs | Grow |
  | `/grows/schemes`, `/grows/share-links`, `/grows/following` | what belongs to growing without being a grow, behind the doors of "Alle Grows" | Grow |
  | `/log` | opens the entry sheet | - |
  | `/timeline` | Verlauf of the chosen place, its whole view in the query (below) | Verlauf |
  | `/control/:page?` | Steuerung of the chosen place, and the pages behind its rows: `alarms`, `plan`, `outputs`, `mode` | Steuerung |
  | `/devices/:deviceId/:page?`, `/devices/:deviceId/sockets/:socket` | a device's own page with `advanced`, `details` under it; one smart socket | Steuerung |
  | `/devices` | names nothing: the not-found page inside the shell | Steuerung |
  | `/cameras/add` | adding a camera (`?kind=rtsp` opens the page on its address form) | Steuerung |
  | `/claim` | adding a device: **outside the bar** (`handle: BARE` on the route; `AppShell` then draws the page alone, with the toasts and the window's title), as `/spaces/:spaceId/edit` and `.../remove` are; `?space=` claims into a place, `?device=&ask=&at=&made=` picks a flow up | - |
  | `/cameras/:cameraId` | a camera | none |
  | `/alerts`, `/tasks`, `/me/...`, `/admin/...` | Meldungen and the task list its door opens, Ich, the fleet screens | none |

- **Start** is `src/screens/start/`: `Start.tsx` decides what `/` is - one place (`PlaceStart.tsx`, also the page of
  `/spaces/:spaceId`), a grow that stands in no place (`GrowStart.tsx`), the cards of several (`Places.tsx`) or the
  empty Start - and `place.ts` holds what all of them decide before drawing: the status sentence, a reading's
  verdict, the lamp's window. `card-status.ts` is the same sentence for a place's card and the header's choice of
  place, so the three never disagree about a tent.
- **Grow** is `src/screens/grow/`: `CurrentGrow.tsx` (the bar's item) and `GrowPage.tsx` (a grow by its id) draw
  the same `GrowScreen` - `GrowHead`, `GrowMenu` and the tab the address names (`grow-tabs.ts`: the diary is the
  address itself, an unknown segment leads there). The diary and the pictures are one read,
  `GET /v1/grows/{id}/diary` (`useGrowDiary`, a few weeks a page): `diary/days.ts` puts a day's answer into the
  words and the order a card draws - titles, the climate line, the folded lines, the pictures of a day - and
  `diary/Diary.tsx`, `diary/DayCard.tsx` and `pictures/Pictures.tsx` draw them. A line is `ui/Lines.tsx`, the row
  Start's last lines are too. `Grows.tsx` is the list at `/grows`. The days are drawn by `Days` for whoever reads
  (`DiaryReader` in `diary/days.ts` says what the diary gives them the way to): the grow's own page hands it the
  sheet that corrects a line and the curve of a moment, the public page (`screens/public/Diary.tsx`) neither.
  A grow's days are counted in the owner's zone, which a grow carries as `summary.zone`; a client that counts a
  day itself - the day a line is dated to - hands it to `growDayAt`.
- **Steuerung** is `src/screens/control/`: `Control.tsx` draws the page and the pages behind its rows.
  `PageRows.tsx` is the one assembly of those rows - which of Alarme, Grow-Plan, Ausgänge and Betriebsart a list
  of devices has something on, and what each row says (`rows.ts`, which also dates what a silent device is said to
  do, `standOf`) - drawn for a place by Steuerung and for one device (`alone`, its links carrying `?device=`) by
  that device's own page. `ByDevice.tsx` draws a page behind a row device by device, and the sentence of a page
  with nothing (`NothingHere`); `lead.ts` says which device is the place's climate and the order of the others
  (`inOrder`). `climate/` is the light and the targets of one device: `Climate.tsx` (the targets, each write
  through one `write()` that pauses a plan where it has to and answers with the toast), `LightCard.tsx` with
  `LightSheet.tsx`, `PresetSheet.tsx`, `ValueSheet.tsx` (the sheet any figure of a device is changed on),
  `Pending.tsx` (the note on what a device has not been handed) and `saved.ts` - **the one save path**:
  `useSaved(device).say(what, undo, from)` answers a write with the toast, `useSettings(device)` writes the
  settings beyond the targets and reads what is pending of them. `devices/Settings.tsx` holds the lines every
  such setting is drawn with (`SettingsBlock`, `NumberSetting`, `ChoiceSetting`, `SwitchSetting`), of which the
  panels of a Plantalytix Socket, a LIGHT, an AIR fan and a fridge's fans are made. `Mode.tsx` and `Outputs.tsx`
  are their pages, `DevicesHere.tsx` the cards and rows of what stands in the place, `held-light.ts` the one
  reader of a lamp held by hand, `alarms/use-silence.ts` with `alarms/Silence.tsx` the hour of silence an alert's
  card shares. `OwnSettings.tsx` draws what one device is set to, for the lead on Steuerung and for every other
  device on its own page. **A device's pages** are `src/screens/devices/`: `DevicePage.tsx` (the page, `advanced`
  and `details` under it), `DeviceSettingsSheet.tsx` (rename and move), `Firmware.tsx` with `FirmwarePin.tsx` and
  `firmware-builds.ts`, `DeviceActions.tsx` (maintenance, restart, update - shared with Steuerung's card),
  `Maintenance.tsx` (the maintenance control, also Start's, and the restart sheet), `ControlSwitch.tsx`,
  `SocketPage.tsx`, `SocketSheets.tsx` (the pairing row, the change and remove sheets) and `HandHold.tsx` (the
  one control for an output held by hand, also under Ausgänge). **The camera page** is
  `src/screens/camera/CameraPage.tsx` with `days.ts` (the slider's days, from the grow's diary read), `Films.tsx`
  and `CameraSettings.tsx`; the day it shows and the diary it leads to share `?day=`
  (`screens/grow/diary/read-back.ts`). **Start** reads the place's lamp once for the page and its card (`useLamp`,
  `screens/start/reads.ts`). What a silent device has not been handed is `pending` of `useDeviceLive`
  ([server-engines.md](server-engines.md#read-models)), read through `climate/figures.ts`.
- **The chosen place** (`src/app/places.ts`) is what `/grow`, `/timeline` and `/control` show: the place
  their address names in `?space=`, else the one chosen (`terp.place` in this browser, a store the header's chip and
  the page both follow), else the first of Start's order (`sortedByAttention`), which is then kept. `usePlaceChoice`
  is the one resolver - the pages read it through `useCurrentPlace`, the chip (`shell/PlaceChoice.tsx`) and the entry
  sheet's aim (`log/underneath.ts`) directly. A page that belongs to one place says so with `usePageOfPlace` (a
  grow's pages with `usePageOfGrow`): that chooses the place and tells the chip where a choice leads, as
  [app-ux.md §2](app-ux.md#2-navigation-and-the-place-page) lists it. A choice made on one of the four is a navigation
  to the item's address with `?space=` - on a page below Steuerung to that page's address -, kept once that
  address is on screen. The effect that keeps a pick does not write over a choice made since its render: the page mounted
  with it may have chosen first. `useCurrentPlace` takes a `?space=` the account has not got out of the address, but
  not while the home is being read again - a link names a place made a moment ago before the home lists it.
  `timelinePath` and `controlPath` build the links that name a place - `controlPath(spaceId, page, { device })`
  the one that opens a page behind Steuerung's rows with a device unfolded -, `devicePath`, `socketPath` and
  `cameraPath` those to a device, one of its sockets and a camera. The way back is no part of a link: the head's
  arrow steps back in history (`ui/BackLink.tsx`, [app-ux.md §2](app-ux.md#2-navigation-and-the-place-page)), and
  only a socket's row under Ausgänge hands its page an address (`leadingBackTo`), for the page to put in its own
  place once the socket is removed. Verlauf's view is read and written
  only in `src/screens/timeline/view.ts` (below), through which `app/old-charts.ts` maps old bookmarks too.
- **Verlauf** is `src/screens/timeline/`. `view.ts` is its address and nothing else: `viewOf` reads it, `viewParams`
  writes a change of it, and the arithmetic of a window lives beside them - `windowOf` (a chip, a width ending
  now, a window that stands still, a window named past now - today - which ends now and follows it, the day
  around a moment the chip does not reach), `askOf` (what the server is asked: a chip by its name, so Start's two
  curves and Verlauf share one cached answer; any other window by its two ends, today's by its own midnight so
  its answer keeps one key all day), `stepped`, `toNow`, `zoomed` over the ladder `WIDTHS`, `selected` for a
  stretch marked or pinched to, `dayHolding` / `dayWindow`, and `definitionOf` / `appliedOf` for a view kept in
  the account. The parameters: `range`
  (`24h` left out, `7d`, `30d`, `phase`, `grow`), `from` + `to` (a window that stands still), `last` (seconds of a
  width ending now that no chip names), `at` (the cursor), `grow`, `device`, `show` (the keys ticked: metrics,
  `m.<key>` for a grow's own measurement, `light`, `outputs`, `diary`, `machine`), `one`, `step`, `vpd`,
  `compare` (`grow:<id>` or `space:<id>`), `focus`. `model.ts` turns one answer into what is drawn - which curves
  the place offers and which are ticked, each panel as a `Plot` with its figures, the strips and the curve each
  stands under (`ACTS_ON`), what a cursor reads, the table - so `Timeline.tsx` holds the view and the reads and
  nothing of the arithmetic. `Panel.tsx`, `Strips.tsx`, `CursorCard.tsx`, `DiaryCard.tsx` and `Adjust.tsx` draw;
  `labels.ts` says when; `window.ts` holds the bands by day and night and the picture of a moment. One read
  answers the page, `GET /v1/spaces/{id}/timeline` (`useTimeline`, `src/api/timeline.ts`), asked for every panel a
  place can have so the sheet offers a tick only for what is there; a second one of the same route is what is
  laid over, and a grow's own measurements come from `useMeasurementSeries`. What the place reads now comes with
  the answer (`reading`), so the page asks no `/live`: `panelsOf` closes each curve of a window that holds that
  reading with it, which is what "jetzt" is, for a share link's reader as for the owner. The cursor is the
  address's `at` and nothing else: only while it is dragged, and from being set down until the address has
  followed, is it held in state, which every change of `at` clears. A read that fails for a new
  window leaves `data` empty in TanStack Query - `keepPreviousData` holds only while pending - and, asked
  again, goes back to "pending" with no error; so `usePage` keeps the last answer and which window was refused
  with what itself, and hands them on as `failed` and `refusal` until a read succeeds. What an address names
  is looked up first in what the account holds (`Vain`): a device it has not got and a grow that stands in no
  place are said and dropped without asking; a device of the account that never stood in the place is told by
  the server's refusal (`device_not_here`). A change of the view is a
  `setSearchParams` with `replace`, which React Router applies as a transition: what has to show at once - a tick
  in the sheet, the cursor under a thumb - is held in state beside it. `terp.curves` remembers the last ticks for
  an address that names none. The page a share link shows (`SharedTimeline`) is the same screen without the
  account's half (`Own`).
- The old Angular app's addresses still work (`OldAddresses.tsx`, `old-charts.ts`, redirects at the end of
  `screens`): `/login?recovery=|?code=` from old mails, `/demo` (website buttons; a signed-in user goes straight in),
  `/list`, `/account`, `/shares`, `/diagnostics`, `/device/<id>/<page>` (the same page of the device's place) and
  old chart bookmarks. Old share links (`?share=`) and `/link-expired` say the link ended. The addresses the
  rewrite gave up since - a place's own tabs, `/grows/archive` - get no redirect (Chris, 2026-11-11).
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
- To keep the last good answer drawn while the next window is read: `placeholderData: keepPreviousData`
  (`useTimeline`), with the screen dimming what it still shows. The lint rejects keeping it by hand: a ref read or
  written during render (`react-hooks/refs`) and setState in an effect (`react-hooks/set-state-in-effect`).
- `noLongerThere()` (`problem.ts`) is the 404 test: `access()` answers 404 to a reader who may not see a subject and
  403 to a refused write. Not every 404 is a subject gone: `GET /v1/devices/{id}/plan` answers 404 `plan_not_found`
  for a device that runs no plan (`isMissing`, `src/api/plans.ts`). Refusals are worded by `refusalText()`
  (`src/ui/refusal.ts`). `readProblem()` makes up code `unexpected` when a proxy answers HTML, so key on the HTTP
  status where it matters (sign-in's 429).
- Export zips are served to a session only: `apiBlob()` into a blob and an `<a download>` (`useDownloadExport` in
  `src/api/exports.ts`), since a link cannot carry the bearer header.
- Lifecycle mutations (`src/api/lifecycle.ts`) re-read the grow after the server answers instead of patching the
  cache, because the server works out day counter, stage and placements; the entry sheet's queue
  (`src/log/LogProvider.tsx`) confirms first and sends after.
- `useUpdateDevice` and `useConfigure` write the answered device into the device list as well as under its own
  key, so a new name, place or setting is on screen before the list is read again. `socketsKey` and `liveKey`
  (`src/api/devices.ts`) are the keys a device's socket table and live values are read under, for whoever reads
  one again by hand - `answerSoon` after a command (`screens/devices/sockets.ts`).

## Session

`src/api/session.ts` is a store outside React (`useSession()`):

- `POST /v1/sessions` answers a user token (5 min), a refresh token (30 min; 30 days with "stay logged in") and a
  media token (30 days). Only the refresh token is stored, under `terp.session`: `localStorage` with "stay logged
  in", else `sessionStorage` (the demo too).
- The user token is refreshed 30 s before it dies, one refresh in flight for all callers. At boot the stored refresh
  token is always tried; the browser's clock does not judge its expiry.
- **Opened cold, the refresh and the home do not wait for the first render**: `warmUp()` (`src/app/warm-up.ts`, from
  `main.tsx`) starts the refresh beside the catalogues and prefetches `['home']`, which every screen in the shell
  reads, as soon as it succeeds - only where the address matches the route `SESSION_ROUTE`, so public pages keep
  deciding for themselves, and never without a live session, as a failed first read stays drawn as failed. The API
  answers preflights with `Access-Control-Max-Age` (a day; Chrome keeps two hours), because every call carries a
  bearer token and Chrome otherwise keeps a preflight five seconds - a round trip more per request on a cold start.
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
  keeps drawing what it held, and the entry sheet's lines would be retried with the demo's token.
- `queryClient.clear()` under a mounted observer whose fetch is in flight cancels that fetch silently and leaves the
  observer pending until its component re-renders (checked against TanStack Query 5.103). So a cache that held no
  session's answers is not cleared: a stored session refused at boot on `/g/:slug`, whose read waits on that very
  refresh, could otherwise leave the public grow loading.
- The demo is `POST /v1/sessions/demo` and has no account: account routes (`/v1/me` and its kin) answer 403
  `no_account`, so account reads are gated - `useAccountMe()` in `src/api/account.ts` - and
  `src/ui/session-access.ts` answers `view` for it in every place, so it is offered no write. Leaving the demo
  only forgets its session: `session.logOut()` sends no `DELETE /v1/sessions/{id}` for it, which the server
  refuses a session that may write nothing - a refused request on the way from the demo to sign-up. Public pages fire no
  session-bound read for a stranger or the demo; only a signed-in reader's Follow reads its follows.
- Access in a place is the server's `space.youMay`, read through `src/ui/session-access.ts` (`useMayInSpace`,
  `useMayManage`, `useMayLogIn`, `useMayWith`, ...); never derive it from owner ids. What to draw for which role:
  app-ux.md §5.
- Browser storage holds per-browser conveniences only (`terp.language`, `terp.theme`, `terp.place`,
  `terp.shape.<user>`, `terp.loaded.<user>` - when Start last had an answer, for a Start that cannot load -
  `terp.lightHold.<device>` - the last light hold sent, `{ state, until }`, since no device reports one back; read
  and written in `screens/devices/lights.ts` alone -, `terp.curves` - the curves last ticked in Verlauf - ...); whatever has to follow the account (zone, diary layer,
  notices seen, the language for text the server writes) lives in `me.preferences`. `localStorage` is read and
  written through `src/ui/stored.ts`, which answers null and keeps nothing where storage is blocked; only
  `src/api/session.ts` has its own, as it uses `sessionStorage` too.

## Charts

- ECharts through `echarts/core`, with the pieces drawn registered in `src/charts/Chart.tsx` - a line chart, the
  grid and mark areas; a new chart type is a line there. The binding is an effect, a `ResizeObserver` and
  `dispose`, and redraws when `data-theme` or the system scheme changes. Colours come from `src/charts/tokens.ts`,
  which reads the CSS variables - a canvas cannot.
- A plot is described as data (`Plot`, `src/charts/series.ts`) and turned into an option in one place,
  `plotOption`: each line against a scale of its own, so several units share a picture; the nights, the bands and
  an alarm's stretch as mark areas of the first line; and behind a line the stretch between its points' lowest
  and highest as two stacked series (`stackStrategy: 'all'`, or a low below zero would not stack). From 130 points
  down each point is a symbol.
- ECharts' own axes are hidden; the figures app-ux.md §7 asks for are DOM around the plot (`screens/timeline/
  Panel.tsx`). The cursor is an HTML overlay with the gestures of `useScrub` (`src/charts/scrub.ts`): a chart is
  drawn once per answer and scrubbing costs no redraw. The overlay claims sideways gestures only
  (`touch-action: pan-y`) and holds a touch back until it travelled sideways or lifted as a tap, so the page
  scrolls over a plot; two pointers are a pinch; a mouse reads while it moves and marks a stretch by dragging.
  Ctrl + wheel needs a listener of its own that is not passive (`Panel.tsx`), or the browser zooms the page.
- Axis bounds come from `niceScale()` in `src/charts/series.ts`, with both corners snapped to the step's decimals:
  a corner one ULP above a round number (169 × 0.2 = 33.800000000000004) trips an ECharts assert that exists only
  in development builds, i.e. under the dev server.
- Gridlines fall on the account's clock and calendar (`src/charts/ticks.ts`); a label that would stand on another
  is left out where the axis is drawn (`Axis`, `Panel.tsx`).
- A point of the server's is stamped where its window closes; the page draws it at the window's middle
  (`pointsOf`, `screens/timeline/model.ts`), which is where a mean belongs and what lines a curve up with the
  strip of the output under it.

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
  (`operatingMode.drying`). `dontCacheBustURLsMatching` in `vite.config.ts` now exempts only
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
- **The built stylesheet drops the unprefixed `backdrop-filter`.** Where a rule writes it beside
  `-webkit-backdrop-filter`, the build's minifier keeps the prefixed one alone, which Chromium does not read: the
  dev server blurs and the production bundle does not. The header and the tab bar were translucent over that blur,
  and in the built app the page's text showed through them (found 2026-11-12), so both are solid now
  (`app/shell/TopBar.module.css`, `TabBar.module.css`). Do not bring the blur back, and judge anything translucent
  on a build (`npm run build && npm run preview`), not on the dev server. The photo caption (`ui/ui.module.css`)
  still writes the pair and is equally unblurred when built.
- While a sheet is open the page behind it does not scroll: `html:has([data-scrim])` in `src/styles/global.css`,
  the attribute being the sheet's backdrop (`ui/Sheet.tsx`). The place sheet is portalled to `<body>`, because the
  header it is opened from is a layer of its own under the tab bar.
- `src/theme/inter-tabular-digits.woff2`, the digits-only face behind `--font-figure`, is cut by
  `scripts/tabular-digits.py`; run it again after upgrading `@fontsource-variable/inter`. `logo-reverse.png` is
  derived from the colour logo by `scripts/derive-logo.mjs`.
- An Erweitert item is a file `*.advanced.tsx` exporting `items` built with
  `advancedItem({ scope, id, order, shows, Item })`, found by `import.meta.glob` in `src/ui/advanced/registry.ts`.
  One scope, `device`, drawn open on the device's page `/devices/:id/advanced`
  (`screens/devices/DevicePage.tsx`). The fast-refresh lint rule is off for these files. A device item's
  settings are the lines of `screens/control/devices/Settings.tsx` on `useSettings` (`climate/saved.ts`), named as
  `CONFIGURATION_FIELDS` names them per type (`shared-types/src/v1/configuration-fields.ts`, the AIR fan and the
  LIGHT included): a figure opens the value sheet, a switch is written on the tap, both through `useConfigure`
  (`PATCH /v1/devices/{id}/configuration` with `set`) and answered by the toast; a line then shows what the
  server stored. A stream camera's Erweitert is no item: it is a fold of the camera's settings sheet, saved with
  it (`screens/camera/StreamOptions.tsx`).
- On a desktop the shell centres every screen's root with a left margin (`.main > *` in
  `src/app/shell/AppShell.module.css`). A root that sets `width: 100%` therefore also needs a `max-width`
  (`--page-width`, `--reading-width`), or the margin pushes it past the window's right edge and the page scrolls
  sideways from about 1400 px - a place's page at `/spaces/:id` did, until it took `--page-width` itself.
- The window's title follows the page's `<h1>` inside the shell (`app/shell/page-title.ts`). Outside it nothing
  does, so the card every such page stands in names it: `Door` (`src/screens/Door.tsx`) takes `page` - or the
  step's `title` - and sets "… – Terp Control". A tab that came from the demo carried the demo place's name over
  the sign-up form until it did. An address that names nothing has its `<h1>` from `NoLongerHere`
  (`ui/PageState.tsx`).
- A toast is the entry sheet's (`src/log/LogProvider.tsx`): a line on its way to the server, with Undo. `tell({
  label, undo, from })` says something already done - an offer declined on Start, a setting saved, a command
  taken - with the caller's own way back; nothing is sent for it. `from` names the control where it may be used
  again at once, and its next toast takes the last one's place: `<device>:<setting>` through the save path's
  `say`, `firmware-<device>`, `maintenance-<devices>`, `device-<device>` (rename and move), `plan-<device>`,
  `rule-<rule>`, `silence-<rule>`. `log/toast-room.ts` keeps the toasts to two and says where they stand while a
  sheet is open (`besideSheet`: under its box, over it, or in its foot). `Toasts.tsx` draws them through a
  portal into an element of its own and puts that element there: on `<body>`, fixed, or into the place every
  sheet keeps for it between its body and its button row (`[data-toasts]`, `ui/Sheet.tsx`), where the sheet's
  flex column gives it the room. It measures the top sheet (`[data-scrim] [role=dialog]`) by `offsetTop` and
  `offsetHeight`, which a transform does not move, so neither the sheet's rise nor a pull misplaces a toast; the
  room toasts already take in the foot is counted back out, or the answer would flip between foot and outside.
  It follows the page with a `MutationObserver` and the sheet's box with a `ResizeObserver` only while a toast
  is shown. The element carries the live region's mark (`ANNOUNCER`, `ui/live-region.ts`), so a sheet opening
  does not make a toast inert. `complete(taskId, label, { changed })` reads again
  what a tick changed beyond the diary - `planMoved` (`src/api/plans.ts`) for a plan step, whose plan and device
  reads would otherwise say the step that was left until their next beat.
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
  `spaceWhere(youMay)`), `test/fixtures.ts` a device (`deviceWith`), `test/place-wire.ts` a place as the server
  answers it and the wire it is read through (the Start suites), `test/harness.tsx` the drawing (`drawAt`,
  `testClient`, `json`, `NOT_FOUND`), `test/translations.ts` the shipped catalogues (`catalogue`, `translate`). Screen
  tests mock `@/api/session` and stub `fetch`. Off a terminal only failures are printed, and console output from a
  passing test is a fault to fix. `npm run test:live` (node environment) signs in with `AGENT_TESTING_*` from the root
  `.env` against a running stack.
- A chart is a canvas, which jsdom has not got: a screen test mocks `@/charts/Chart` with an element that carries the
  plot's label, and what a plot draws is held as data by the model's tests (`test/timeline-model.test.ts`, which
  reads `plotOption`'s series). jsdom has no `matchMedia` either, so `useWideWindow` answers "wide" under test; a
  test of a phone's layout stubs it (`test/timeline.test.tsx`). A gesture is fired as a `MouseEvent` given a
  `pointerType` and `pointerId`, and a mouse leaving as `pointerout` with a `relatedTarget`, which is what React
  works a leave out from (`test/scrub.test.tsx`).
- `test/toast.tsx` (`Toast`) is the seam for a screen that answers through `tell`: Alarme, the plan panel, an
  alert's card and the device pages need it, or `LogProvider`. `test/toasts.test.tsx` holds the toasts' limit and
  their place beside a sheet; jsdom lays nothing out, so it hands the sheet its `offsetTop` and `offsetHeight`.
  In every other suite a sheet measures nothing high and the toasts stay on `<body>`, outside the dialog.
- A memory router keeps no entries on the window's history, so in it every page is one opened by its address and
  the head's arrow leads to its parent. `test/back-arrow.test.tsx` draws in a browser router on jsdom's history
  instead, stubs `window.scrollTo` (jsdom has none and says so on the console) and disposes its routers after
  each test - a router left behind keeps listening to `popstate` and throws into the next test.
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
