---
summary: Putting a device's settings back after an accidental change (a plan started on the wrong device, a test on a real one) - where the previous values are kept and how to write them back through the API
updated: 2026-10-08
source: the restore after an accidental plan start, 2026-10-05; device configuration, target record, plan and auth code of the server as of 2026-10-08
paths:
  - server/src/modules/device-protocol/device-configuration.service.ts
  - server/src/modules/v1/device/devices.controller.ts
  - server/src/database/schemas/v1/target-changes.schema.ts
---
# Restoring a device's settings

1. **Find the device.** An id taken from the app's address may be the place (space), not the device.
   `GET /v1/devices?spaceId=<id>` lists the devices in it, or in MongoDB
   `db.devices.find({ spaceId: '<id>' }, { id: 1, name: 1, type: 1 })`.
2. **Stop what changed it.** A running plan sends its step's settings to the device every hour, so end it first:
   in the app, or `DELETE /v1/devices/<id>/plan`.
3. **Find the previous values** (read-only, in MongoDB):
   - `targetChanges` has one row for each change of the targets or the light cycle, by whoever made it -
     the targets and the schedule at any instant: `db.targetChanges.find({ deviceId: '<id>' }).sort({ at: -1 })`.
   - The diary has every write as an entry listing the changed figures as `before → after`:
     `db.entries.find({ deviceId: '<id>', 'message.key': 'message-device-configuration-updated' }, { occurredAt: 1, authorId: 1, 'message.params': 1 }).sort({ occurredAt: -1 })`.
   - Until the release that drops `legacy_*`: `legacy_devices` holds each migrated device's whole configuration as
     it was at the migration, as a JSON string (`db.legacy_devices.findOne({ device_id: '<id>' }).configuration`).
     The diary says whether anything changed after it.
4. **Write it back through the API**, not into MongoDB: only the API sends it to the device, records it in
   `targetChanges` and writes the diary line. Sign in as an administrator (`POST /v1/sessions` with the
   `ADMINUSER_*` account, then `Authorization: Bearer <userToken>`), `GET /v1/devices/<id>/configuration`, change
   the values, and `PUT /v1/devices/<id>/configuration` with `{ "configuration": { ... } }`. The document is replaced
   whole, and a figure outside what the firmware reads is refused before anything is written. The automation token
   does not open this route: its session passes only the admin routes (`/v1/admin/...`).
5. **Check.** A device that is online reports within seconds. One that is offline gets the stored configuration
   when it next connects - the cloud's copy wins over the device's. The diary shows the change under the
   administrator's name.

**What cannot be restored:** the figures the server decides itself and recomputes on every save - for a fridge
`daynight.maxDehumidifySeconds`, `daynight.targetHumidityDiff`, `daynight.useLongHumidityAvg`,
`daynight.linearChange` and `co2.sunsetOff` (`server/src/modules/device-protocol/class-rules.ts`). The work mode is
not taken from the document either: a `PUT` keeps the mode the device runs, unless `drying` or `germination` beside
`configuration` starts or ends one (`server/src/modules/device-protocol/work-modes.ts`). Change it in the app's
controls.
