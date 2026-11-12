---
summary: The app rewrite is complete (merged 2026-10-04) - where its decisions and knowledge live now, and what it left open; read before picking up one of those open items
updated: 2026-11-12
source: rewrite sessions 2026-09-16..10-04 with Chris's instructions in them (2026-09-17, 2026-09-22); PR #104 and the pull requests after it; verified against the code on 2026-10-08; Chris and a read of the web app on 2026-11-11 (navigation), its first round on 2026-11-12; round 4 of the navigation redesign (the redesign session of 2026-11-12)
paths:
  - webapp/src/screens/me/appearance/**
  - webapp/src/api/plans.ts
  - server/src/modules/v1/diary/tasks.service.ts
  - webapp/src/screens/camera/add/**
  - firmware/src/wifi.cpp
  - firmware/src_hwtype/**
---
# The app rewrite

The rewrite replaced the Angular web app with the React app in `webapp/`, the server's app-facing routes with the
`/v1` API whose contract is `shared-types/src/v1/`, and the old database shapes with the model of ADR 0001; the
device-facing routes stayed as they were. It was merged on 2026-10-04 as #104 and is complete. Internal notes on its
product side exist outside this repository.

## Where its knowledge lives

- [ADR 0001](adr/0001-app-rewrite-data-model.md): the data model, the `/v1` API and the migration.
  [ADR 0002](adr/0002-app-rewrite-frontend-stack.md): the web app's libraries and its look.
- [device-protocol.md](device-protocol.md): the frozen contract with the firmware.
- [`server/src/migrations/README.md`](../server/src/migrations/README.md) and the runbook
  [Upgrading an install from before the app rewrite](runbooks/upgrade-a-pre-rewrite-install.md): upgrading an install
  from before the rewrite. The server migrates the database at boot and no command undoes a run, so the way back is a
  backup that has been restored once before the upgrade.
- The rules and traps this document used to collect are in the topic documents: [server](knowledge/server.md),
  [data](knowledge/data.md), [webapp](knowledge/webapp.md), [app-ux](knowledge/app-ux.md),
  [firmware](knowledge/firmware.md), [testing](knowledge/testing.md), [ci-and-release](knowledge/ci-and-release.md),
  [development-workflow](knowledge/development-workflow.md). How it was verified on copies of production data:
  [verification passes](knowledge/testing-real-devices-and-data.md#verification-passes).

## Left open

Checked against the code on 2026-10-08; the navigation item on 2026-11-12. Take an item out once it is done.

- **The navigation is to be reordered** (Chris, 2026-11-11: the diary is hard to find, places and rooms are
  inconsistent, the charts are less precise and less intuitive than the old app's). The direction is chosen (Chris,
  2026-11-11; internal notes exist) and a click prototype outside the app comes before any change to it. The new
  routes need no redirects from today's, and a change to the data model comes as a migration step (Chris,
  2026-11-11). It is built in rounds; the bar, the header's choice of place, the addresses, Start, the grow page
  with its diary by the day, the public page on the same day cards, and Steuerung with a page per device and the
  camera page are in since 2026-11-12 ([app-ux.md §2](knowledge/app-ux.md#2-navigation-and-the-place-page)), the
  other pages follow. A read of the whole web app on 2026-11-11 found, as the things the redesign still has to
  settle:
  - Verlauf and Graphen are two screens over one engine. Verlauf's windows all end now and it cannot zoom; Graphen
    can step back and zoom, is reached by a chip in Verlauf's range row, and opens on 24 h
    whatever Verlauf showed. On touch a drag only moves the cursor (`webapp/src/charts/scrub.ts`), so zooming is the
    button "Hineinzoomen", and every zoom is a new read.
  - A curve's automatic step is `max(60 s, range / 480)` and each point a mean without minimum and maximum
    (`server/src/modules/v1/timeline/timeline-window.ts`). The comment on `MIN_STEP_SECONDS` there says no device
    reports faster, but devices send a `bulk` sample every 5 s ([device-protocol.md](device-protocol.md)) and the
    store honours an asked step from 5 s (`server/src/modules/data/flux.ts`). The old page loaded 5 to 20 s points up
    to a day and zoomed on them in the browser.
  - A claim offers "ein neuer Ort" first when places exist (`screens/claim/CodeStep.tsx`), so a second device in the
    same tent makes a second place and Start turns into the several-places layout.
  - The weight is live duplication, not dead code: 21 ideas (place chooser, rename sheet, maintenance, climate
    preset, light limit, ...) are each built in three to nine places, against one unused export.
  - Round 4 (Steuerung, devices, camera), state of 2026-11-12 (the redesign session; rules in
    [app-ux.md §2, §3, §5, §8](knowledge/app-ux.md)). Built and committed, checks green, walked on a development
    stack in seven account shapes, phone and desktop, light and dark:
    - *Steuerung with "Geräte in …"*: built (`screens/control/Control.tsx`, `climate/`, `rows.ts`, `Mode.tsx`,
      `Outputs.tsx`, `DevicesHere.tsx`). Nothing is a draft: a sheet per figure, per light window and per preset,
      each write answered by a toast with undo. Not seen on a stack, tests only: a paired smart socket's rows, a
      place led by a Plantalytix Socket, a LIGHT or an AIR fan, a running or paused plan, the screens in English.
    - *The device's own page*: built (`/devices/:id` with `sockets`, `advanced`, `details`, and
      `/devices/:id/sockets/:socket`; `screens/devices/`). The prototype's "meldet sich alle 5 s · WLAN gut" is
      not drawn: the app has no such data. "Update auf …" is offered only to a device whose automatic updates are
      off (a newer stable build than the one the cloud knows it runs); a device on a channel reads "kommt von
      selbst" - a "now" for those needs a server route.
    - *Offline does not lock*: built. Proven with the simulator: a save is stored at once and published once on
      the device's `configuration` topic, which a silent device misses; on its next connect its `fetch` is
      answered with the stored document, and it acknowledges nothing. So the page says what the cloud stored
      since the device was last heard and what it had stored by then - `pending` of `GET /v1/devices/{id}/live`
      ([server-engines.md](knowledge/server-engines.md#read-models)), computed from the target record and the
      diary line of a person's save, no new stored field. Its limits: nothing is said in the first ten minutes of
      silence; a figure outside the target record that a plan or a preset moved meanwhile, and one past the twelve
      a long diary line names, are not known.
    - *The camera page*: built (`screens/camera/CameraPage.tsx`, `days.ts`, `Films.tsx`). The slider runs over
      the days of the grow running in the camera's place and is not drawn without one, or for a second camera of
      one place: the diary names one still per day. Scrubbing through one day's stills went with the prototype's
      design; the day's film and Verlauf's cursor are to show them (round 5).
    - *Several devices in one place*: built as far as the app goes - Steuerung's top is the device the server
      names as the place's climate (`screens/control/lead.ts`), every other device draws its own settings on its
      page with the way to its curves. What becomes of a place with two climates stays the data model's question.
    - *The list `/devices`*: gone, with its panels, the second Erweitert under the targets, the maintenance
      sheet, `/control/targets` and the light limit's second slider. Erweitert lost the work mode, a fridge's
      fans, continuing a plan, the update channel, pairing a socket and giving a device up to places of their own.
    - *The freshness pill*: a device's and a camera's page date themselves in their head; the fleet screens say
      "Stand vor …" beside their title (`AdminHead`).
    - Not done, and not to be forgotten: `webapp/src` came down by about 150 lines only (tests by about 690) -
      the sheets, the pending marks and three sub-pages cost what the list saved. What could still go: the panels
      that are forms with their own Save and leave question (a socket's switching, a LIGHT's window, a fan's
      speeds, a fridge's fans; `screens/control/devices/`, `Guarded` in `OwnSettings.tsx`) are a second way to
      change a setting beside the sheets; Start's and Ich's door rows are not yet `ui/Rows`. The first choice of
      place now prefers a place where a grow runs beside a device (`firstChoice`, `app/places.ts`), without a
      test of its own. Switching control on stands on Steuerung, where the climate would be, and on the device's
      page; off only on the device's page. Maintenance, a restart and an update stand on the device's card and on
      its page alike, against "every setting has one place" read strictly - they are done to the hardware, not
      settings; Chris's to confirm. The session's critic has not walked this round yet.
  - A line of the diary opens Verlauf on its moment however old; today one from more than 30 days back opens the
    grow's whole stretch, the only window that holds it, because Verlauf's windows all end now (round 5: Verlauf's
    address carries its window).
  - Waiting for Chris's word (asked on 2026-11-12, no answer yet). The rules the redesign session set itself after
    its critics' walks - the calendar's day count, which lines a day card shows, the week cards' removal from the
    contract - are marked as such where they stand and are his to confirm with the redesign's pull request. And
    six things went with the grow page's tab "Wochen" that no page shows any more, against the rule that no old
    capability disappears silently ([app-ux.md](knowledge/app-ux.md)); each comes back or is decided away:
    - how many of a scheme week's feedings are logged ("n / m erledigt") - the week's feed lines and the rhythm
      behind "m" were reads of the removed week cards, the tab Düngung makes neither;
    - the day/night strip and the light hours per week (the report has them per phase);
    - a reading with its change from the week before (the Messwerte page has the curves);
    - the days of each stage in the head's bar;
    - strains and plant count in the head (the tab Pflanzen and the cards of "Alle Grows" have them);
    - the entry tiles' captions with the last value (the watering detail says when and how much the last was).
    Also open: whether a day's camera picture outlives the camera's retention - today only a still that a diary
    line or a grow's cover names is spared.

- **Unit preferences are saved, not applied.** Me › Appearance stores °C/°F, g/oz and l/gal (`preferences.units`),
  but every figure is still drawn in °C, g and l, as the page's `unitsNote` tells the reader; only the Me screen's
  summary line reads the choice (`webapp/src/screens/me/doors.ts`).
- **Plan templates cannot be renamed or deleted in the app.** `PATCH` and `DELETE /v1/plan-templates/{id}` exist;
  `webapp/src/api/plans.ts` only lists and creates.
- **Two task sources are not derived.** The contract's `taskSource` names `scheme` and `plan_suggestion`, but tasks
  come only from reminders and from plan steps waiting to be confirmed; `server/src/modules/v1/diary/tasks.service.ts`
  says why.
- **A standalone Terp Cam cannot be added.** The app does not offer it any more (Chris, 2026-10-08, for now) and
  `POST /v1/cameras` refuses `terpcam_standalone` with `not_yet`: a Terp Cam is reached over a relay its device
  opens, and one paired at no device has nothing to open it. The kind stays in the model in case it comes back.
- **The firmware since 2026-09-23 has not been checked on hardware.** #109, #110, #111 (fridge heat pulses,
  controller heater cut, fridge SCD4x fallback), #128 (Terp Cam relay on AIR and plug) and #141 (settings reported
  on connect) say in their descriptions that they were not tried on a device, and no `/firmware-check` is recorded
  for them or for the rewrite's own firmware changes: the smart-socket roles, overrides and protections
  (`firmware/src/wifi.cpp`, `firmware/src_hwtype/plug/plug.cpp`) and the controller's germination cooling with the
  exhaust (`firmware/src_hwtype/controller/controller.cpp`). A passing check comments "Skill check: ..." on its pull
  request. Two server behaviours also want a real device to confirm them: the 24-hour light encoding
  (`ALWAYS_LIT_FROM` in `shared-types/src/v1/day-night.ts`) and the schedule re-sent when the clocks change
  (`server/src/modules/device-protocol/schedule-clock.service.ts`).
