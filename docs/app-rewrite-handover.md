---
summary: The app rewrite is complete (merged 2026-10-04) - where its decisions and knowledge live now, and what it left open; read before picking up one of those open items
updated: 2026-11-11
source: rewrite sessions 2026-09-16..10-04 with Chris's instructions in them (2026-09-17, 2026-09-22); PR #104 and the pull requests after it; verified against the code on 2026-10-08; Chris and a read of the web app on 2026-11-11 (navigation)
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

Checked against the code on 2026-10-08; the navigation item on 2026-11-11. Take an item out once it is done.

- **The navigation is to be reordered** (Chris, 2026-11-11: the diary is hard to find, places and rooms are
  inconsistent, the charts are less precise and less intuitive than the old app's). The direction is chosen (Chris,
  2026-11-11; internal notes exist) and a click prototype outside the app comes before any change to it. The new
  routes need no redirects from today's, and a change to the data model comes as a migration step (Chris,
  2026-11-11). A read of the whole web app on that day found, as the things the redesign has to settle:
  - No bar item, tab or title reads the diary: it is the grow page's tab "Wochen", filed under Start
    (`webapp/src/app/shell/tabs.ts`), and the camera page is filed under Geräte.
  - Steuerung and Geräte show the same devices from two sides and draw the same `DeviceAdvanced`
    (`screens/control/targets/Targets.tsx`, `screens/devices/DeviceList.tsx`).
  - Verlauf and Graphen are two screens over one engine. Verlauf's windows all end now and it cannot zoom; Graphen
    can step back and zoom, is reached by a chip in Verlauf's range row and one on the grow page, and opens on 24 h
    whatever Verlauf showed. On touch a drag only moves the cursor (`webapp/src/charts/scrub.ts`), so zooming is the
    button "Hineinzoomen", and every zoom is a new read.
  - A curve's automatic step is `max(60 s, range / 480)` and each point a mean without minimum and maximum
    (`server/src/modules/v1/timeline/timeline-window.ts`). The comment on `MIN_STEP_SECONDS` there says no device
    reports faster, but devices send a `bulk` sample every 5 s ([device-protocol.md](device-protocol.md)) and the
    store honours an asked step from 5 s (`server/src/modules/data/flux.ts`). The old page loaded 5 to 20 s points up
    to a day and zoomed on them in the browser.
  - A claim offers "ein neuer Ort" first when places exist (`screens/claim/CodeStep.tsx`), so a second device in the
    same tent makes a second place and Start turns into the several-places layout.
  - The weight is live duplication, not dead code: 22 ideas (place switcher, place chooser, rename sheet, maintenance,
    climate preset, light limit, ...) are each built in three to nine places, against one unused export.

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
