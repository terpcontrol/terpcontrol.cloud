---
summary: Why the cloud keeps the times of day a device runs by (light on and off, CO2 windows, socket timers) on its owner's wall clock and moves them when summer time or the owner's zone changes - read before touching a time of day in a device document, the account's zone or the schedule clock
updated: 2026-10-08
source: rewrite commits of 2026-10-01 and 10-02 merged with PR #104; checked against server/ and shared-types/ on 2026-10-08
paths:
  - server/src/modules/device-protocol/schedule-clock.ts
  - server/src/modules/device-protocol/schedule-clock.service.ts
  - server/src/modules/device-protocol/device-configuration.service.ts
  - server/src/database/schemas/v1/devices.schema.ts
---
# ADR 0005: The times a device keeps stay on its owner's wall clock

- **Status:** accepted on 2026-10-01; built and merged with #104 on 2026-10-04.
- **Date:** 2026-10-01
- **Touches:** `server/` (device protocol module, plan service, account), `webapp/` (where times of day are set)
- **Builds on:** [ADR 0001](0001-app-rewrite-data-model.md): the device protocol is frozen and the firmware changes
  as little as possible.

## Context

The firmware keeps every time of day as seconds past midnight UTC and knows no zone: when the light comes on and
goes off, when an AIR fan may add CO2, when a smart socket's timer switches. A grower sets "light on at 08:00" on
the clock on their wall, and that clock jumps twice a year. Left alone, a light set to 08:00 in a Berlin summer
came on at 07:00 all winter, and the app then showed 07:00 although nobody had changed anything. The old app had
the same fault.

Giving the firmware a zone would change what every device reads, and not every device updates.

## Decision

The cloud remembers which clock the seconds were meant on and moves them when that clock moves. The firmware and
the protocol stay as they are.

- **The anchor.** Every write that sets times of day stores, on the device row and never served, the owner's zone
  and its UTC offset at that moment (`devices.scheduleClock { zone, offset }`, `schedule-clock.ts`).
- **The loop.** Once a minute (`schedule-clock.service.ts`) the server compares each anchor with the owner's
  offset now. When it has moved - summer time began or ended, or the owner named another zone - it shifts every
  time of the document by the difference and sends the document again through the usual configuration path, so
  the wall clock keeps reading 08:00.
- **Everything a device keeps moves together**: `daynight` on controllers, fridges and socket hubs, a LIGHT's own
  pair, an AIR fan's CO2 window and the windows of a smart socket's timer. A CO2 window left on UTC while its light
  moved would spend an hour of gas in the dark. The plan's documents follow too, or the hourly re-send would put the
  old hour back.
- **Writes catch up.** A write that leaves the times alone while the clock has moved - a plan step re-sent in the
  minute after the change, a temperature saved from a page drawn before it - moves them instead of pinning the old
  hour.
- **Only a zone somebody picked is a clock** (`preferences.timezoneChosen`). Accounts start on UTC, and every
  account carried over from the old cloud was put on UTC, though its owner set the light by a local wall clock.
  The app replaces that UTC with the zone of the first browser it is opened in; reading that as a move would shift
  every migrated lamp by hours on its owner's first visit. So a schedule is anchored only once the zone is a chosen
  one, and anchoring never moves anything.
- **Times set on the device's own menu** let go of the old anchor, and the next pass anchors them without moving
  them. Releasing a claim forgets the anchor, so the next owner's starts fresh.

## Consequences

- The app shows and sets times of day on the account's wall clock and turns them into the document's UTC seconds
  at today's offset, which is the offset the server anchors the save on.
- A preset or a plan step changes how long the light stays on, never when it comes on; only a step that names the
  morning moves it (ADR 0001, plan steps carry light hours).
- Which half of the targets holds at a given second is still the firmware's arithmetic on those UTC seconds,
  which the cloud copies ([ADR 0006](0006-day-and-night-by-the-device-clock.md)).
- `server/test/unit/schedule-clock.spec.ts` runs the loop through the nights summer time ends and begins in
  `Europe/Berlin` (06:00 UTC before, 07:00 after, 08:00 on the wall both times, sent once, no diary line), a change
  of zone, an account that adopts a zone, the device's own retiming and the echo of the server's own send.
