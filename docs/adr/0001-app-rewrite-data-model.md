---
summary: The /v1 data model, the API conventions and routes, the access rule, the frozen device protocol and the migration from the old database - read before changing a collection, a route, a migration step or anything a device touches
updated: 2026-10-08
source: Chris (decisions 2026-09-17, backend sign-off 2026-09-19); rewrite sessions and the commits of PR #104 (2026-09-16..10-04); PR #141; checked against server/, shared-types/ and firmware/ on 2026-10-08
paths:
  - server/src/database/**
  - server/src/migrations/**
  - server/src/modules/**
  - server/src/common/v1/**
  - shared-types/src/v1/**
---
# ADR 0001: Data model and API for the app rewrite

- **Status:** accepted on 2026-09-17 (revision 3). The model, the API, the frozen device protocol, the
  migration, the single firmware change and the order of delivery are agreed; the questions left open at the
  end each carry the assumption the work proceeds on.
- **Amended** on 2026-09-19 (Chris's sign-off of the backend as built), 2026-09-22 and 09-23 (access and sharing,
  measurement bands, the migration's names and corrections), 2026-10-01 to 10-04 (the work mode, the target
  record, light hours, the plan routes) and 2026-10-07 (a device's settings in its `fetch`). Each change is marked
  "Amended <date>" where it stands and says what it replaced. Built and merged with #104 on 2026-10-04; every
  question left open at acceptance is answered, and two have been opened since (see the end). Decided on their own
  since: [ADR 0005](0005-device-times-on-the-wall-clock.md) (device times on the wall clock),
  [ADR 0006](0006-day-and-night-by-the-device-clock.md) (day and night by the device's clock),
  [ADR 0007](0007-germination-in-the-dark.md) (germination in the dark).
- **Date:** 2026-09-17
- **Touches:** `server/`, `shared-types/`, `firmware/` (smart sockets; more since, see the firmware delta),
  `scripts/simulate-device.mjs`, `fw-buildcontainer/`, `garmin/`

Revision 1 kept every existing shape alive and added the new model beside it: optional fields, read-time
normalisers, legacy fields written forever, a mirror between the old camera settings and the new camera record.
That is the smallest diff and the wrong goal. It leaves two vocabularies for every fact and makes the model
harder to reason about with every release. Revision 2 replaces it: **one well-defined model, one consistent
API, a real migration, and a frozen device protocol.**

## Context

The web app is being rewritten from scratch in React against a set of decided screens. The decision record and
the screens are kept with the company documents; this ADR records what they require of the server, the wire
shapes and the firmware. The screens assume twelve things the server does not have today:

1. A **space** (tent, fridge, room, balcony, no fixed place) that is not a device, with optional room grouping.
2. A **grow**: plants, photoperiod or autoflower, phases with a source, time-ranged placements in spaces, a
   feeding scheme with overrides, reminders, visibility and privacy, a cover image.
3. An **entry** with optional grow, plant and space references, an author, a kind and structured values.
4. A **task**, derived or stored.
5. **Membership** per space or room with two roles, and invite links.
6. A **camera** as its own record with an entitlement date, several per tent.
7. **Measurement definitions** per grow; feeding **schemes** as client assets with per-grow overrides.
8. A **share link** keyed by grow or space with a time range; a public page and a link card.
9. **Follow**, user to grow.
10. The manual stage picker writes the same phase the grow plan writes.
11. More **socket roles** and per-socket timed overrides that reach the firmware.
12. **RTSP cameras** through the controller; **standalone Terp Cams** without one (kept in the model, not reachable
    yet: see the cameras paragraph below).

Rules of the record that bind the model: no persona or mode selection; Premium covers camera images only; every
value carries an age (live under 2 min, stale 2 to 10 min, offline after 10 min, dimmed and never hidden); grows
exist without devices and devices without grows; no location is stored; harvest weights are hidden in shared
views by a setting; no comments, no feed, no directory.

### Requirements for the backend

- The database and the API are **well defined, consistent, unambiguous and normalised**. Data and API are
  **migrated** to the new model rather than extended beside the old one.
- The **firmware changes as little as possible**, and everything a device touches stays **backward compatible**,
  because not every device will update: its HTTP routes, the MQTT protocol, and the shapes on both.

### Decisions already taken

Settled on 2026-09-17 and written into the sections below rather than left as questions: the API has no other
users, so nothing of today's routes is kept for compatibility and the Garmin widget moves to `/v1` with them;
`/v1` is served under the base URL that deployed firmware builds already carry; the migration is rehearsed against
the database of the simulated stack (*amended 2026-09-19:* and against copies of the hosted database, see
"Tooling"); old share links and saved chart presets are not migrated; a camera gets twelve months of Premium when
it is first claimed or paired, and every camera that exists at the migration starts its twelve months on migration
day; pairing a standalone Terp Cam from the phone ships as "coming soon" and gets its own session once the rewrite
is merged.

Settled on 2026-09-19, when Chris signed off the backend: **a space is not deleted while it still has members**,
which is the opposite of what this record assumed. Deleting an account is the other act and stays possible, see
"Places, people, grows" below. And a **plan step names no stage unless somebody says so**: `stage` and `preset`
are omitted from a step a client writes, and the plan that comes back carries them as `null`.

Also settled in that sign-off, whose answers are dated 2026-09-19 (Chris): **the alarms on outputs are kept** and
the model grew a rule for them ("If that's missing in the concept, the concept is wrong"); a device keeps running
the plan it had, and saving it again follows the same rules, which is where the stageless step above comes from;
**there is no rollback command** ("This is what backups are for"); **the stale warning is opt-out**; of the two
sensor-fault lines a fridge repeats, the migration keeps the newest 100 per device and **the firmware logs each at
most once every 15 minutes**; the light row is two controls, the controller's dimmable output and every light
socket on its own; and which work mode a climate preset sets was left for later - decided on 2026-10-02 and 10-03,
see "The server decides the work mode" and ADR 0007. Everything else the sign-off asked was agreed as assumed
("Assume the rest is agreed"), which answers the open questions at the end.

### What is ambiguous today

- **Two naming styles** in one document (`device_id`, `owner_id`, `maintenance_mode_until` beside `cloudSettings`,
  `hardwareInfo`, `activeSince`), and three kinds of timestamp (epoch milliseconds, BSON dates, ISO strings).
- **The device document is everything**: owner, name, alarms, the running plan, the camera, the socket table.
  There is no space, grow, plant, membership, follow or entitlement anywhere.
- **Configuration and state share a subdocument.** An alarm holds its thresholds and whether it is triggered, and
  the client posts the whole array back. The plan holds its steps and its position.
- **Meaning by convention**: a diary entry's kind is the second element of `categories`; `deleted: true` means
  "hidden from the device card"; a share link's id is its secret token and its time window lives in an unenforced
  query string; `username` is an e-mail address; `user_id` has no unique index; `images` also holds videos;
  `recipe` is what the screens call a plan; `configuration` is JSON inside a string.
- **RPC-style routes without a version** (`/device/setname`, `/device/configure`, `/tokenlogin`), reads that
  answer 201, errors in several shapes, no pagination.
- **No migration tooling.** Shapes change by optional fields and normalisers that are never removed.

## Decision

1. **One model.** Every noun of the screens is one collection with one schema. References are ids. Nothing is
   stored twice, and nothing is signalled by a field being absent.
2. **One API**, versioned under `/v1`, resource-oriented, with one set of conventions for names, ids, time,
   errors, lists and status codes. Today's app routes go away together with the Angular app.
3. **A real migration.** Versioned, ordered, resumable migrations run at boot. Each old collection is renamed
   aside and transformed into its new shape, so the old data stands untouched beside the new for one release.
   The way back is a restore from the backup; what the old collections give is the evidence to put a wrong
   transform right by hand without reaching for one.
4. **A frozen device protocol.** The firmware's HTTP routes and the whole MQTT protocol keep their exact shapes.
   One server module owns them and translates between the device's vocabulary and the model.
5. **One firmware change**, for smart sockets (item 11), gated by capabilities the device reports. *Amended
   2026-09-19 to 10-07:* the firmware changed in a few more places, each one backward compatible with the server
   either side of it; see "Firmware delta".

## The device protocol (frozen)

This is everything a device touches, confirmed from the firmware source (`firmware/src/fridgecloud.cpp`). It
keeps its paths, bodies, status codes and key names. Changes here are additive and gated by a capability the
device reports, never anything else.

| Surface | Shape | Used by |
| --- | --- | --- |
| `POST /device/register` | `{ registration_password, device_type, device_id, username, password }` → 201 `{ fw }` | "Change server" on the device |
| `POST /device/claimcode` | `{ device_id, password }` → 200 `{ claim_code }` | the claim code on the display |
| `GET /device/firmware/:firmware_id/:binary` | the bytes, with `Content-Length` | OTA |
| `POST /auth/v0.0.1/device/claimcode`, `GET /auth/v0.0.1/device/firmware/:firmware_id/:binary` | as above | older builds |
| MQTT `/devices/<id>/{status, bulk, fetch, log, configuration, image, tunnel_read}` (device → server) and `{command, firmware, configuration, tunnel_write}` (server → device) | unchanged payloads, including the `hardware-info:` log sub-protocol and the device-owned configuration document | every device |
| MQTT `/devices/<id>/fwupdate` (`{ version, url }`) and `/devices/<id>/control/#` | subscribed by every device, never published by the server today; they stay reserved and the broker's topic rules keep covering them | every device |
| MQTT `/devices/<id>/status/sensors/<key>` and `/status/outputs/<key>` | bare values a device publishes in its custom-MQTT mode; the server accepts and drops them, quietly rather than by a caught exception as today | devices in that mode |
| `POST /mqttauth/:secret/{user, vhost, topic, resource}` | unchanged | the broker |
| The API base URL compiled into each firmware build | `/v1` lives under the same base | every device |

These routes live in one `device-protocol` module. It is the only place that knows the device's snake_case
names, its epoch seconds, its `message-key:param` log lines and its flat `hardware-info` keys, and it translates
them at the boundary. The protocol gets a reference document, `docs/device-protocol.md`, written from the code.

*Amended 2026-10-07 (#141):* a device's `fetch` also carries the settings it runs with, because a cloud without a
configuration for it (a fresh registration, a restored backup) otherwise waited for one forever. The server stores
them only while it holds none, by a write conditional on `configuration: null`, so the cloud's copy always wins
and is sent down as before. Additive: a `fetch` without them is read as it always was.

## Conventions

These hold for every collection, every schema in `shared-types` and every route.

- **Names** are `camelCase` in the database and in JSON. Collections and path segments are plural; path
  segments are `kebab-case`. Enum values are `snake_case`, which is also what the firmware already uses for
  socket roles and stages, so they need no translation.
- **Ids.** Every resource has a string `id` with a unique index. References are `<resource>Id`. Mongo's `_id`
  is internal and never leaves the server. A device's `id` is the id its firmware was provisioned with.
- **Time.** Instants are BSON dates in the database and ISO 8601 UTC strings in JSON, and every instant is
  named `...At` or `...Until` (`createdAt`, `startedAt`, `measuredAt`, `validUntil`), without exception.
  Durations are integers named with their unit (`forSeconds`), except where the user's own unit is the fact
  (`{ value: 3, unit: "weeks" }` on a plan step).
- **Presence.** A field that belongs to a resource is always present. "None" is `null`. Nothing is signalled by
  absence, and a list is `[]`, never missing.
- **Configuration and state are separate.** What a client may write and what the server or a device maintains
  never share a writable object. Maintained values sit in a read-only `state` object on the resource
  (`devices.state`, `cameras.state`, `plans.state`, `alarmRules.state`, `invites.state`, `shareLinks.state`).
  Identity and ownership (`id`, `ownerId`, `createdBy`, `createdAt`) are set at creation and immutable.
- **A reference to one of several kinds** is `subject { type, id }`, never a row of fields of which exactly one
  is filled.
- **One schema per resource** in `shared-types`, from which the types, the validation and the OpenAPI document
  are generated as today. Request bodies are derived from the resource schema, not restated. The package offers
  the contract twice: flat interfaces with no dependency on zod, for a client, and the schema objects
  themselves, so the server validates against the contract rather than against a copy of it. The legacy
  contract went with the Angular app (#104). *Amended 2026-09-18 to 10-03:* arithmetic that both ends must agree
  on lives in the contract as well, in modules without a schema (`feeding.ts`, `grow-days.ts`, `day-night.ts`,
  `value-age.ts`, `climate-presets.ts`, `configuration-fields.ts` and a few more), which the server, the web app
  and the simulator import at runtime as `@fg2/shared-types/v1-schemas/<module>.js`: two copies of a rule agree
  until one of them rounds differently.
- **The server compiles strictly.** "None is `null`" only survives into the inferred types under
  `strictNullChecks`; without it a schema and the type generated from it describe different shapes.
- **Routes** are resource-oriented under `/v1`: `GET` list and read, `POST` create (201 with the resource),
  `PATCH` partial update (200 with the resource), `PUT` for a singleton that is replaced whole, `DELETE` (204).
  `DELETE` ends a resource's life for clients. Where history still refers to it (a space, a camera) the
  document stays as a tombstone with `archivedAt` or `removedAt` and is no longer listed. Giving a device up
  and revoking a link are not deletions and have their own nouns (`/claim`, `/revocation`).
  Work that does not finish in the request answers 202 with a resource that can be polled. Something that
  happens to a resource is a noun below it (`/plan/transitions`, `/tasks/{id}/completions`), not a verb in a path.
- **Lists** answer `{ items, nextCursor }` and accept `limit` and `cursor`; filters are query parameters named
  like the fields they filter.
- **Errors** are `application/problem+json` with `status`, `code`, `title`, `detail` and, for validation,
  `errors[]` by field.
- **Reads answer 200.** Authentication is a bearer token; pictures additionally accept a media token in the
  query string, as today. It lives 30 days, because it sits in the URL of a picture a page keeps showing, and it
  opens pictures only: an export's download refuses it.

## The model

Twenty-eight collections as accepted, twenty-nine since the target record (`targetChanges`, amended
2026-10-01). "→" marks a reference. Every resource also has `id` and `createdAt`; a `state` object is maintained
by the server and read-only. The tables give the decided shape and the fields later decisions added; the stored
schemas in `server/src/database/schemas/v1/` are the field-level truth.

### Accounts

| Collection | Fields |
| --- | --- |
| `users` | `email` (unique), `passwordHash`, `isAdmin`, `isActive`, `activationCode`, `handle` (unique, the only name others ever see), `bio`, `avatarMediaId`, `publicProfile`, `privacy { hideWeights, hideCounts }`, `preferences { units, locale, timezone, timezoneChosen, diary, layoutSeen, notifyLaterUntil, deviceOfferDeclined }`, `retention { climateDays }`, `notifications { channels, routing, quietHours, mutedUntil }`, `deletionStartedAt` |
| `sessions` | `userId`, `userAgent`, `lastSeenAt`, `expiresAt` (TTL). A session can be listed and revoked |
| `passwordResets` | `userId`, `tokenHash`, `expiresAt` (TTL) |
| `pushSubscriptions` | `userId`, `endpoint` (unique), `keys`, `userAgent` |
| `notificationLog` | `userId`, `channel`, `category`, `subject { type, id }`, `externalMessageId`, `sentAt`, `expiresAt` (TTL). What was sent to whom: it keeps a due task from being announced twice and maps a Telegram reply to what it answers |

No real name is stored. `notifications.routing` is the what-goes-where grid; `channels` holds the e-mail address,
the Telegram link and the webhook.

*Amended 2026-09-25 to 10-02.* The old cloud stored no zone, so every account starts on UTC and every migrated one
did. `timezoneChosen` says whether a person picked the zone; until somebody does, the app adopts the zone of the
device it is signed in on, once, and says so. That replaced the rule of 2026-09-23 that the device's zone is only
shown as a hint and never written, which left the times of every migrated grower hours off. `diary` (`on`, `off`,
`null` for not said) is the answer to whether the grow diary is offered; while it is `null` the server works the
answer out from whether the account can see a grow or has written a diary line itself, and `/home` and `/me` both
answer it as `layers.diary`, so every device agrees. `PATCH /me` merges `preferences` key by key and a client
sends only the preference it changes: an object written back whole once raced an adopted zone back to UTC.

### Devices

| Collection | Fields |
| --- | --- |
| `devices` | `type`, `classId`, `serialNumber`, `ownerId`, `spaceId`, `name`, `mqtt { username, passwordHash }`, `firmware { channel, targetId }`, `configuration` (an object, or `null` before the device reported one; its schema belongs to the firmware of that type), `settings { vpdLeafOffsetDay, vpdLeafOffsetNight, ppfdLuxFactor }`, `isDemo`, `state { lastSeenAt, claimedAt, firmwareId, updateStartedAt, updateEndedAt, updateFailedAt, maintenanceUntil, hardware (the raw `hardware-info` report), socketStateChangedAt (slot → instant), socketsReportedAt }`; server-side only (amended 2026-10-01 to 10-03): `scheduleClock { zone, offset }` (ADR 0005), `baseWorkmode`, `standardWorkmode`, `beforeDrying`, `beforeGermination`, `germinationChoices`, `restedHumidityBand` (the work mode, below, and ADR 0007; the answer's `control` is read from them), `cameraSecret`, `climateSweptAt` |
| `deviceClasses` | `name`, `description`, `concurrentUpdates`, `maxFailures`, `firmwareIds { stable, beta, alpha }`, `rollout { paused, percent }` |
| `firmwares`, `firmwareBinaries` | `classId`, `name`, `version`, `wasStable` / `firmwareId`, `name`, `data` |
| `claimCodes` | `code` (unique), `deviceId` (unique) |
| `plans` | `deviceId` (unique), `templateId`, `name`, `steps[] { id, name, stage, preset, duration { value, unit }, settings, lightHours, waitForConfirmation, confirmationMessage, germinationChoices }` (`lightHours` and `germinationChoices` amended 2026-10-02 and 10-03), `loop`, `notify { mode: off · on_step · on_confirmation, email, writeEntries }`, `state { status: running · paused · stopped · completed, activeStepIndex, stepStartedAt, pausedElapsedMs, pauseReason, lastAppliedAt, confirmationNotifiedAt, confirmationAskedAt, confirmationAskTriedAt }` |
| `planTemplates` | `ownerId`, `name` (unique per owner), `isPublic`, `steps[]` |
| `alarmRules` | `deviceId`, `name`, `watch` (one of `{ kind: reading, metric, upper, lower }`, `{ kind: output_level, output, upper, lower }`, `{ kind: output_running, output }`), `forSeconds`, `severity: critical · warning · info`, `origin: preset · always · device · human`, `presetId`, `presetKey` (which of a stage's bands a `preset` rule is; server-side only), `enabled`, `cooldownSeconds`, `repeatSeconds`, `delivery { mode: routing · custom, custom }`, `silencedUntil`, `state { triggered, lastTriggeredAt, lastResolvedAt, extremeValue, lastSampleAt }` |
| `alerts` | `ruleId`, `deviceId`, `cameraId`, `spaceId`, `kind`, `severity`, `startedAt`, `resolvedAt`, `value`, `extremeValue`, `watched` (the rule's name and watch when the episode opened), `rested` (ADR 0007) |
| `targetChanges` | `deviceId`, `at`, `targets { day, night }` (temperature and humidity of each half), `cycle { day, night, workmode, sunrise, sunset, glides }`; one row each time the targets or the cycle in a device's configuration move (amended 2026-10-01) |

The device document keeps what the device is. What a human thinks about moves out: the plan, the alarm rules,
the camera. Today's `cloudSettings` dissolves: the firmware channel goes to `devices.firmware`, the VPD and PPFD
factors to `devices.settings`, the camera fields to `cameras`. Sockets and capabilities are typed views of
`devices.state.hardware`, served by the API and never stored twice. An alert is one document from trigger to
resolution, which is what the alerts inbox shows; today it has to be paired from two log lines. `delivery.mode:
custom` keeps today's per-alarm e-mail and webhook with its templates and the tunnel; `routing` uses the
person's notification settings.

*Amended 2026-10-01 and 10-03:* **what a device aimed at is recorded.** InfluxDB keeps readings and never
setpoints, and the configuration only says what is aimed at now, so `targetChanges` is the one place the past of
a target band and of the nights can be read from: a row each time the targets in a device's stored configuration
move, whoever moved them (a save, a plan step, a preset, the device's own menu), none for a write that moves
nothing, and each row with the cycle that decides which half holds. Timeline and Charts cut their bands where the
record says the targets moved, and the cockpit's verdict judges each window against what held then
(`server/src/modules/v1/device/held-targets.ts`). It replaced drawing a band from the phase's snapshot alone,
which disagreed with the cockpit whenever a preset moved the targets of a grow already in its stage; the snapshot
is still read where the record says nothing. Migration 018 opened the record for every device.

An alarm watches a reading or an output. The tent that gets too warm is the rule everyone writes, but a grower
also watches what the controller is *doing*: the fridge that has not stopped running in an hour, the CO2 valve
that is still open, the heater working harder than it should be. Both are alarms in the same sense, and the
outputs are a vocabulary the model already has for its charts, so the rule names one or the other rather than
pretending an output is a reading. What trips them differs, though, which is why `watch` is a choice between
shapes and not a wider enum: a band is what a reading is watched against and what an output's level is watched
against, and an output watched for running at all has no band to give - anything above zero is the output
working, and `forSeconds` is what makes that an alarm rather than a fact of every cycle. Written this way, a
rule that names an output and a threshold nothing would read cannot be written down at all.

### Places, people, grows

| Collection | Fields |
| --- | --- |
| `spaces` | `ownerId`, `kind: tent · fridge · room · balcony · other`, `name`, `roomId` (→ a space of kind `room`, one level), `presetPrompt: ask · never`, `retention { climateDays }`, `isDemo`, `archivedAt` |
| `memberships` | `spaceId`, `userId` (unique together), `role: can_log · can_manage`, `invitedBy`, `inviteId`. A membership on a room covers its spaces; a person may hold a row on a room and one of their own on a tent in it, and the stronger role counts (amended 2026-09-22). The owner is `spaces.ownerId`, never a row |
| `invites` | `code` (unique, 8 characters from the claim-code alphabet), `spaceId`, `role`, `createdBy`, `expiresAt`, `revokedAt`, `state { useCount, lastUsedAt }` |
| `grows` | `ownerId`, `name`, `description`, `type: photoperiod · autoflower`, `phases[]`, `placements[]`, `scheme`, `measurements[]`, `visibility: private · public`, `publicCameras` (whether the public page shows the camera's pictures; amended 2026-10-02), `slug` (unique), `coverMediaId`, `filmMediaId`, `startedAt`, `endedAt`, `isDemo`, `updatedAt` |
| `plants` | `growId`, `strain`, `label`, `status: active · harvested · ended`, `harvest { harvestedAt, wetWeightG, dryWeightG }` |
| `follows` | `userId`, `growId` (unique together) |

- **A plant is a document.** "Amnesia × 8" on the new-grow sheet creates eight plants labelled "Amnesia 1" to
  "Amnesia 8". Entries, cameras, phases and placements refer to plants by id, a split harvest selects plants,
  and a count is simply how many there are. Weights live on the plant and are stripped from shared views.
- **`Phase`** `{ id, stage, preset, startedAt, source: preset · plan · human, plantIds, deviceId, targets,
  setBy }`. `stage` is the six-value botanical stage. `preset` is the climate preset that was applied, such as
  `late_flowering`, which is how "Late flower" is drawn without a seventh stage. `plantIds: null` means every
  plant; a list is the scope of a split. `targets` is a snapshot of the controller's day and night targets,
  which gives charts a target band over a past phase (Influx stores sensors and outputs, never setpoints);
  *amended 2026-10-01:* where the device's target record says more, the band follows the record (see Devices).
  `grows.phases[]` is the single truth for day counter, phase and the "auto" tag.
- **`Placement`** `{ id, spaceId, startedAt, endedAt, plantIds }`. `spaceId: null` is "no fixed place";
  `endedAt: null` is open. "4 drying in the fridge, 4 still flowering" is two open placements and a drying
  phase scoped to four plants.
- **A lifecycle fact is one fact** (agreed with the sign-off, 2026-09-19). A phase or a placement is told twice,
  as its row and as the diary line that announced it, so correcting it moves both and withdrawing it deletes both;
  who decided and which controller ran are never corrected. A grow always stands somewhere: withdrawing its last
  open placement is refused (`grow_stands_nowhere`), and "nowhere" is a move to `spaceId: null`. A typed wet or
  dry harvest total is shared evenly over the plants named, the last plant taking the rounding remainder so the
  sum is what was typed, and the last harvest ends the grow. A split is a scoped phase and placement inside the
  same grow, not a second grow. Migrated grows have no plants, which every plant-scoped rule has to allow.
- **`scheme`** `{ origin { type: asset · own, assetId, version, schemeId }, strength, waterEc, plantType,
  flipWeek, edited, grid }`. Shipped schemes are JSON assets in the client and the server never reads one, so
  the grow stores the effective grid. That also keeps a grow's history stable when a scheme is edited later.
- **`measurements[]`** `{ key, name, unit, perPlant, targetMin, targetMax, chart }`, the definitions of this grow.
  *Amended 2026-09-22:* the single `target` became `targetMin` and `targetMax`, each nullable, because the boards
  draw a target as a band ("1.4-1.8"). Two nullable ends rather than an object leave one spelling of "no target";
  one end alone means "at least" or "under". A derived target such as "runoff EC below input + 20 %" is
  deliberately not expressible and lives in the template's description. Migration 016 spread a stored figure over
  both ends.
- **A space with members is not deleted.** `DELETE /v1/spaces/{id}` refuses while a membership names it, beside
  the device, camera, grow and room it already refuses for, and the refusal says how many people are in it and
  that they are removed first. Letting somebody go is a thing their host does deliberately, one person at a
  time; a delete button that did it in passing would tell them by taking the tent away. The members counted are
  the space's own rows - a membership held on the room above reaches in as well, but it is the room's, and a
  room is already refused while any space is grouped under it, so a shared room is emptied and then meets its
  own members rather than making every tent inside it undeletable.
- **Deleting an account is the other act, and stays possible.** A person cannot be held in an account because
  somebody else is a member of their tent, so `DELETE /me` removes the memberships on the spaces it owns as part
  of deleting them. The two are not the same thing said twice: ending one space is a place closing while its
  owner goes on using the app, and the people in it have somebody to hear it from, whereas deleting an account
  ends everything at once and there is nobody left to hand a tent over to. Handing the space to a member instead
  would give somebody a tent they never asked to own, with its devices and its history, at the moment its owner
  left; the members lose their access either way, and this way nobody inherits anything by surprise.
- **Rooms, tents and invites** (amended 2026-09-22). A tent refuses to change or remove a member whose row is the
  room's (409 `member_of_the_room`): the room answers for its own people. When the host removes a member who came
  in through an invite, that invite is revoked with the membership, so the same code cannot let them straight
  back in; a member who leaves on their own leaves the code alone. Remembering who was removed from where, to
  refuse them later, was rejected.

### Diary, tasks, pictures

| Collection | Fields |
| --- | --- |
| `entries` | `kind: water · feed · photo · note · measurement · training · phase · move · harvest · visit · alarm · plan · system`, `occurredAt`, `source: human · device · plan · preset · alarm`, `authorId`, `growId`, `spaceId`, `deviceId`, `plantIds[]`, `cameraId`, `taskId`, `alertId`, `severity`, `text`, `message { key, params[] }`, `values` (typed per kind), `mediaIds[]`, `undoUntil` |
| `reminders` | `subject { type: grow · space, id }`, `kind: water · feed · chore · custom`, `label`, `everyDays`, `onceAt`, `assigneeId`, `defaults`, `createdBy` |
| `cameras` | `ownerId`, `kind: terpcam_controller · terpcam_standalone · rtsp`, `deviceId`, `spaceId`, `name`, `looksAt`, `plantIds[]`, `did`, `uid`, `ip`, `secret` (server only), `url`, `transport`, `tunnel`, `model`, `stillIntervalSeconds`, `nightOff`, `maintenanceOff`, `logErrors`, `staleWarning` (amended 2026-09-19, see "The alarm engine"), `entitlement { validUntil, grant }`, `isDemo`, `removedAt`, `state { lastStillAt, lastError, firmwareVersion }` |
| `media` | `kind: still · timelapse · photo · avatar · export` (`export` amended 2026-09-22, see "Exports"), `mime`, `bytes`, `cameraId`, `growId`, `spaceId`, `uploadedBy`, `capturedAt`, `endsAt`, `window: day · week · month · custom`, `quality`, `lengthSeconds`, `render` (composer options and status), `exportJob` (an export's scope and status), `lit` (whether a still was taken with the light on). Unique on `{cameraId, kind, window, capturedAt}` for camera media |
| `schemes` | `ownerId`, `name`, `origin { assetId, version }`, `grid` (a user's own feeding schemes) |
| `chartViews` | `ownerId`, `name`, `definition` (structured, not a query string) |
| `shareLinks` | `token` (unique, separate from `id`), `kind: view · public_page`, `subject { type: grow · space, id }`, `range { startsAt, endsAt }`, `includeCameras`, `createdBy`, `expiresAt`, `revokedAt`, `state { openCount, lastOpenedAt }` |
| `migrations` | `name`, `appliedAt`, `durationMs`, `stats` |

- **Undo.** `entries.undoUntil` is the instant until which the author may take a line back without anybody else's
  permission; after it, deleting somebody's line is the owner's or a manager's. It is five minutes rather than the
  five seconds the toast shows: the toast is what a person sees, and a window as short as it would be decided by
  the network rather than by them.
- **One timeline.** A human's watering, a device's log line and an alarm are all entries, told apart by `kind`
  and `source`. A device's `message-key:param` line is parsed once into `message { key, params }`. A human
  writes `text`. `values` has one schema per kind; readings of any kind share one shape, `values.readings:
  [{ key, value, plantId }]`, keyed by the grow's measurement definitions. The lines a device and the plan engine
  write for themselves (`system`, `plan`) are kept like any other but left out of week cards and reports.
- **A feed stores what was poured** (2026-09-18), absolute and resolved, so the line reads the same after the
  scheme is edited: litres without doses resolve against the scheme row of the week the feed happened in, doses
  given are stored as given, `schemeWeek` records the row, doses are rounded to two decimals. The arithmetic
  (`shared-types/src/v1/feeding.ts`) is shared by the sheet, which draws the figures before anybody taps, and the
  server, which resolves "log as planned".
- **Tasks are derived**, never stored: from reminders, the grow's scheme grid, the plan's step end and plan
  suggestions, with deterministic ids. "Done" is an entry with that `taskId`.
- **Pictures belong to a camera, a grow or a space, never to a device.** The bytes stay where they are, in the
  GridFS bucket, whose file id is the media id.
- **Time series** stay in InfluxDB, measurement `status`, tagged by `device_id`. The `user_id` tag, which
  records whoever owned the device when a sample arrived and is never read, is no longer written. The API names
  metrics with one enum in `shared-types` that maps to the device's field names.

## Access

One function decides every request: `access(ctx, subject, need)`.

```
need:    own     claim and unclaim, delete a space, grow or camera, members, invites, share links, entitlement,
                 publishing a grow, exports
         manage  configuration, alarm rules, plan (confirming a step through its task too), commands, sockets,
                 camera settings, others' entries
         log     write entries, upload photos, complete tasks, start a visit, edit own entries
         view    every read

subject -> { ownerId, isDemo, isPublic, spaceIds[] }      device, space, grow, plant, camera, entry or media
admin                                    -> allow
demo session                             -> allow view of demo objects, redacted
owner                                    -> allow
member of one of subject.spaceIds        -> view and log; manage with can_manage; never own
need != view                             -> deny
public grow                              -> allow view inside [startedAt, endedAt or now], privacy applied
valid share link covering the subject    -> allow view inside its range; camera pictures only when included
otherwise                                -> deny
```

A grow's spaces are all its placements for `view` and only its open placements for `log` and `manage`. The
allowed range and the privacy owner ride on the request, so every read clamps its range and every serialiser
strips harvest weights, and plant counts when that setting is on, for anyone who is not the owner or a member.
Routes declare their need with one decorator. Camera secrets, webhook targets, headers and payloads are never
serialised to anyone but the owner.

*Amended 2026-09-19 and 09-22*, each found in review and agreed with the sign-off:

- **Needs above a route's own.** Publishing a grow (`visibility` in `PATCH /grows/{id}`) needs `own` while the
  grow's other fields need `manage`. Exporting a grow or the account needs `own`, because an export is filed under
  privacy beside `DELETE /me`; letting co-growers export would be switching that one decorator to `manage`.
  Confirming a plan step through its task needs `manage`, like the transition itself, and plan-step tasks are not
  listed to people who may not confirm them.
- **An administrator is allowed one named row, never a list.** A personal list (the caller's share links,
  cameras, Premium count) stays the caller's own; the install is read through `/admin`, and there is no
  `GET /admin/cameras`.
- **A camera's identity belongs to its host.** `did`, `uid`, `ip`, `url` and `state.lastError` are withheld from
  everybody but the owner and administrators, so a `can_manage` member sees an RTSP camera with `url: null`.
- **A share link's window and switches govern every read it reaches.** Week cards are cut to the window, the
  grow's summary and harvest are computed at its end, a closed window gets no live values, setpoints or
  `lastStillAt`, and an entry outside it answers 404. `includeCameras: false` hides camera ids, picture ids and
  capture instants, not only the bytes. Redaction fails closed when the owner's row is missing, and a revoked or
  expired token answers 404 exactly like one never issued. A public-page link dies with the page: once the grow is
  private again, every address pasted anywhere stops working. A space's member list refuses a share-link grant;
  the guest list is not what a link was handed out to show.
- **Sharing tells nobody whether an account or a code exists.** A member is added by handle only from accounts
  that already share a space with the caller - a public profile consents to being read, not to being put into a
  stranger's tent, so strangers join through an invite they accept themselves - and every other handle, one's
  own included, answers the same 404 `handle_not_found`. An invite preview carries no ids; a revoked, an expired,
  an archived space's and a never-issued code all answer the same 200 `{ isValid: false }`, acceptance refuses
  all four as 404 `invite_not_found`, and accepting twice is 409 `already_a_member`.

`publicProfile` gates the person, not the diary. Without it `/public/users/{handle}` answers 404 and a public
grow's author carries no `bio` and no avatar; the handle is shown either way, because a diary has an author and
the handle is the only name anybody ever gets. A grow's own `visibility` is what decides whether the grow is
readable at all, so somebody can publish a diary without publishing a profile page.

## The API

Everything below is under `/v1`. Every route that exists today and is not part of the device protocol is
removed together with the Angular app.

| Area | Routes |
| --- | --- |
| Sessions | `POST /sessions` (log in), `POST /sessions/demo`, `POST /sessions/automation`, `POST /sessions/refresh`, `GET /sessions`, `DELETE /sessions` (every other session), `DELETE /sessions/{id}` |
| Account | `POST /users` (sign up), `POST /users/activations`, `POST /password-resets`, `POST /password-resets/{token}/redemptions`, `GET/PATCH/DELETE /me`, `PUT /me/password`, `GET /me/export`, `POST/DELETE /me/push-subscriptions[/{id}]`, `POST /me/telegram-link`, `POST /me/email-alarms` |
| Home | `GET /home` (one card per space, and one per grow that stands in no place: live values with age, setpoints, the 24-hour trend, the grow with its newest entries, latest still, due tasks, open alerts; followed grows; `layers`), `GET /home/grows` (every grow the account can see, in one read) |
| Spaces | `GET/POST /spaces`, `GET/PATCH/DELETE /spaces/{id}`, `PUT/DELETE /spaces/{id}/archive`, `GET /spaces/{id}/overview` (with the 24 h climate verdict), `GET /spaces/{id}/live`, `GET /spaces/{id}/timeline` (one answer per range chip: panels with their bands, night, alarms, output lanes, the event rail and the camera frames), `GET /spaces/{id}/series`, `GET /spaces/{id}/co2-report`, `PUT/DELETE /spaces/{id}/devices/{deviceId}`, `POST /spaces/{id}/preset-applications` |
| Members | `GET/POST /spaces/{id}/members`, `PATCH/DELETE /spaces/{id}/members/{userId}`, `GET/POST /spaces/{id}/invites`, `PUT /invites/{code}/revocation`, `DELETE /invites/{code}`, `GET /invites/{code}` (public preview), `POST /invites/{code}/acceptances` |
| Devices | `GET /devices`, `POST /devices/claims`, `GET/PATCH /devices/{id}`, `DELETE /devices/{id}/claim` (give the device up), `GET/PUT/PATCH /devices/{id}/configuration` (`PATCH`: settings by name), `PUT /devices/{id}/co2-fan`, `POST /devices/{id}/commands` (a typed union: reboot, maintenance, socket override, socket set), `GET /devices/{id}/firmwares`, `GET /devices/{id}/live`, `GET /devices/{id}/series` |
| Sockets | `GET /devices/{id}/sockets`, `PUT/DELETE /devices/{id}/sockets/{slot}` (pair by address, role, timer; remove), `PUT/DELETE /devices/{id}/sockets/{slot}/override`, `POST /devices/{id}/sockets/{slot}/tests` |
| Plan | `GET/PUT/DELETE /devices/{id}/plan` (`DELETE` stops; `?steps=remove` takes the plan away), `POST /devices/{id}/plan/transitions` (confirm, skip, extend, pause, resume, goto), `GET/POST /plan-templates`, `GET/PATCH/DELETE /plan-templates/{id}` |
| Alarms | `GET/POST /devices/{id}/alarm-rules`, `PATCH/DELETE /alarm-rules/{id}`, `PUT/DELETE /alarm-rules/{id}/silence`, `GET /alerts`, `GET /alerts/{id}` |
| Grows | `GET/POST /grows`, `GET/PATCH/DELETE /grows/{id}`, `GET/POST /grows/{id}/plants`, `PATCH/DELETE /plants/{id}`, `POST /grows/{id}/phases`, `PATCH/DELETE /grows/{id}/phases/{phaseId}`, `POST /grows/{id}/placements` (a move), `PATCH/DELETE /grows/{id}/placements/{placementId}`, `POST /grows/{id}/harvests`, `POST /grows/{id}/splits`, `GET /grows/{id}/weeks`, `GET /grows/{id}/report`, `GET /grows/{id}/series`, `GET /grows/{id}/export` |
| Diary | `GET/POST /entries`, `GET/PATCH/DELETE /entries/{id}`, `GET/POST /reminders`, `PATCH/DELETE /reminders/{id}`, `GET /tasks`, `POST /tasks/{id}/completions` |
| Cameras | `GET/POST /cameras`, `GET/PATCH/DELETE /cameras/{id}`, `POST /cameras/{id}/test-captures` (answered at once), `GET /cameras/{id}/test-captures/{captureId}`, `GET /cameras/{id}/frames`, `GET/POST /cameras/{id}/timelapses` |
| Media | `POST /media` (a photo), `GET /media/{id}`, `GET /media/{id}/content`, `DELETE /media/{id}` |
| Schemes, charts | `GET/POST /schemes`, `PATCH/DELETE /schemes/{id}`, `GET/POST /chart-views`, `PATCH/DELETE /chart-views/{id}` |
| Sharing | `GET/POST /share-links`, `PATCH/DELETE /share-links/{id}`, `PUT /share-links/{id}/revocation`, `GET /shared/{token}` (resolve), `GET /shared/{token}/weeks`, `GET /follows`, `PUT/DELETE /follows/{growId}` |
| Public | `GET /public/grows/{slug}`, `GET /public/grows/{slug}/weeks`, `GET /public/grows/{slug}/media/{id}`, `GET /public/grows/{slug}/card.png`, `GET /public/users/{handle}`, `GET /public/users/{handle}/card.png`; outside `/v1`, `GET /g/{slug}` and `GET /@{handle}` answer a small HTML shell with Open Graph tags |
| Admin | `GET/POST /admin/users`, `GET/PATCH/DELETE /admin/users/{id}`, `GET /admin/fleet`, `GET /admin/stats`, `GET /admin/logs` (not built), `GET/POST /admin/devices`, `POST /admin/devices/provisioned`, `GET/POST /admin/device-classes`, `GET/PATCH /admin/device-classes/{id}`, `GET/POST /admin/firmwares`, `PATCH/DELETE /admin/firmwares/{id}`, `PUT /admin/firmwares/{id}/binaries/{name}`, `PUT /admin/cameras/{id}/entitlement` |

`GET /healthz` and `GET /readyz` replace `/` and `/readycheck`; the compose health check moves with them.

*Amended 2026-09-18 to 10-03:* a home card carries its own 24-hour trend, from one time-series query across all
devices, because a sparkline fetched per card made a club's home one request per card (09-18), and a grow started
on "no fixed place" gets a card of its own with `spaceId` and `kind` null (09-22). Routes added after acceptance:
moving a device into or out of a space (09-18), `GET /shared/{token}/weeks` and `GET /public/grows/{slug}/weeks`,
which page a long diary's earlier weeks from the same grant as the page and without people, owner ids, device ids
or authors (09-23), `DELETE /sessions`, which a password change also does, because a leaked password otherwise
left every other browser signed in (09-23), `POST /me/email-alarms` (one tap: critical alarms by mail to the login
address, 10-01), `PATCH /devices/{id}/configuration` (10-02, see the work mode below), `PUT /devices/{id}/co2-fan`
(the AIR fan a smart socket slows while it doses CO2, 10-02), `GET /spaces/{id}/series` and `/co2-report` (10-02),
`GET /home/grows` (running grows first, newest first, then finished ones by the day they ended, one cursor across
both, 10-03), and `POST /admin/devices/provisioned` (10-03). The commands union lost the firmware's bench
`test`/`stoptest` (09-24): only a fridge acts on it, and there it bypasses every safeguard the control loop keeps,
the compressor's included - an assembly check, not something to offer beside a grower's climate; a camera capture
is `POST /cameras/{id}/test-captures`. `GET /admin/logs` was never built, though the contract carries its shape
(`AdminLogPage`). Outside `/v1`, `POST /telegram/{secret}` is the bot's webhook. The full list as it stands is the
OpenAPI document the server serves at `/api-docs`.

## Behaviour the model implies

- **Day counter, phase, "auto".** Computed once in the grow serialiser from `phases[]`: `day = floor((now -
  phases[0].startedAt) / 1 d) + 1`; a plant's phase is the latest phase whose scope includes it; the headline is
  the largest plant group, and the groups are listed when they differ; `auto` is `source` in `{preset, plan}`.
  *Amended 2026-09-22 and 09-23:* the arithmetic is shared rather than the serialiser's - `growOriginOf`,
  `growDayAt` and `growWeekAt` in `shared-types/src/v1/feeding.ts`, `stageSpansOf`, `daysPerStageOf` and
  `stageWeekOf` in `grow-days.ts`. Day 1 begins at the earlier of the grow's start and its first phase and is
  counted in elapsed 24-hour periods, so it is zone-free; a stage's last day is the day before the next phase's
  first, so the spans tile the grow and add up to its day count; the server publishes `stageWeek` rather than each
  client counting it. `GET /grows/{id}/series` answers `originAt`, so a day-of-grow axis and one grow against
  another are the client's arithmetic over two ordinary reads, not a mode of the route.
- **One phase writer.** `GrowService.setPhase` is called by the grow routes, the plan engine and
  `preset-applications`. It appends the phase, writes the `phase` entry and re-reads stage-bound alarm
  thresholds from one table in `shared-types`. Applying a preset to a space with an open grow sets its phase;
  without one the answer says so, and the client offers "start a grow here", "move a grow here" or "only
  climate". Nothing is created by a controller merely being on. *Amended 2026-10-01:* a new phase with `climate:
  true` also writes the stage's climate to the controllers where the plants stand, exactly as a preset does; a
  correction takes no climate, because repairing a record moves no tent. The stage's alarm bands follow the phase
  or the climate written: entering, correcting or withdrawing the standing phase re-reads them on every device
  where the plants stand, and a preset applied to a grow already in that stage re-reads that stage's bands.
  Starting a plan puts a grow standing there into the stage of the step it starts at.
- **The plan engine** keeps its 20 s tick, its hourly re-apply and its mails, and reads `plans` instead of a
  field on the device. Pause, resume, skip, confirm and extend are transitions of `plans.state`. Because the
  engine re-applies its step hourly, a preset applied beside a running plan would be undone: when the plan's
  next step carries the requested stage the action becomes a skip, otherwise the plan pauses and the preset is
  applied.
- **The plan routes** (agreed with the sign-off 2026-09-19, amended 09-25 and 10-02). The first `PUT` creates the
  plan at rest, and `resume` starts it. `DELETE` stops it and keeps its steps, like the old app's "Stop recipe":
  stopping must be safe to repeat - a screen may stop a plan it read a minute ago - and must not throw steps
  away when it arrives twice. Taking the plan away is asked for by name, `DELETE ...?steps=remove`; neither sends
  the device anything. Step ids carry the running position across an edit: a step inserted above keeps the tent
  on its step and its clock, and deleting the running step starts its replacement from zero. Every edit clears
  `lastAppliedAt`, so the engine sends the step within a tick. `goto` runs the plan from the start of the named
  step whatever its state (`plan_step_gone` when the step has vanished). Step durations need not be whole, since a
  plan in the field runs a step of half a day.
- **A step's photoperiod is hours** (amended 2026-10-02). `lightHours` (0 to 24, `null` leaves it) is sent as the
  device's own morning and the evening that many hours later, so a template carries hours rather than the UTC
  seconds of somebody else's tent. Only a step that names `settings.daynight.day` moves the morning; a preset
  changes how long the light stays on, never when it comes on. Migration 021 turned the whole windows the old
  recipes copied into every step into hours, keeping the hour only where a recipe really moves it - otherwise the
  hourly re-send put the old "light on at" back every hour.
- **A plan step names no stage unless somebody says so.** `stage` and `preset` are left out of a step a client
  writes and come back as `null`, because a recipe of nothing but climates is the ordinary recipe: every plan
  the migration carried over has a stage on none of its steps, and the guided onboarding's reference plans are
  the only ones that ever wrote one. A step with no stage moves the plan on and writes its diary line like any
  other and leaves the grow's phase exactly where it is. That is what makes the plan of a tent running since
  before the rewrite survive being opened and saved: a contract that asked every step to name one of the six
  stages would have the screen invent them, and the tent would start driving phases it never had.
- **The server decides the work mode** (amended 2026-10-02; the sign-off of 2026-09-19 had left the mapping open).
  The work mode is the one key of a fridge's or a controller's document that says what the hardware does as a
  whole, and the firmware reads any word it does not know as off, so no client writes it. A client asks: with
  `drying` and `germination` on a targets save (`true` starts, `false` ends, left out goes on), or by a setting
  named in `PATCH /devices/{id}/configuration`, which takes the fields `CONFIGURATION_FIELDS` in `shared-types`
  lists for the device's type, refuses anything else or out of range, keeps every other key and writes the diary
  line. The server decides on every write - saved targets, a preset, a phase, a plan step and its hourly re-send,
  a setting by name: a device that was off is switched on by saved targets, a preset, a phase's climate or a plan
  step; a drying stage dries, germination germinates in the dark (ADR 0007), and every other stage, a step that
  names none included, returns to the standard mode the device last ran. What it returns to is kept on the device
  row (`baseWorkmode`; `standardWorkmode` for a fridge's energy saving), because the document says one mode at a
  time and the firmware drops a key it does not know; a drying spell keeps the targets it overwrote
  (`beforeDrying`) and puts them back when it ends. The modes a person picks are one list, `WORK_MODES` in
  `shared-types` - standard, greenhouse, germination, drying; a fridge offers all four, a tent controller all but
  greenhouse (2026-10-06). Migration 019 took `small` and `full` out of plan steps and templates, which a running
  plan would otherwise re-send every hour.
- **Day, night and the clock.** Which half of the targets holds is decided as the firmware decides it, by the
  device's clock window and work mode and never by the lamp ([ADR 0006](0006-day-and-night-by-the-device-clock.md));
  the times of day a device keeps stay on its owner's wall clock across summer time
  ([ADR 0005](0005-device-times-on-the-wall-clock.md)).
- **The alarm engine** keeps its state machine and reads `alarmRules`. A trigger opens an `alert` and writes an
  entry; a resolution closes it. A health loop evaluates the `offline` metric from `lastSeenAt` and raises an
  alert for a camera that stopped delivering stills. **The stale warning is opted out of, not into**: a camera
  arrives with it on and its own settings turn it off, so an install that says nothing - a fresh one, and one
  that has just been migrated - comes up warning about every camera rather than about none.
- **Cameras.** The poller, the timelapse builder, thinning and retention iterate `cameras`. When a device reports
  a paired Terp Cam over MQTT, the protocol module upserts its camera row. A controller still pairs exactly one
  Terp Cam (*amended 2026-10-02:* so do a fridge, an AIR fan and a smart socket, one each); "several cameras per
  tent" is that camera plus RTSP cameras pulled through the controller's existing tunnel plus standalone Terp
  Cams, none of which needs firmware. Creating an RTSP camera is never refused. **Pairing a standalone Terp Cam
  ships as "coming soon"**: the model and the camera kind are built and the tab that would pair one says it is
  coming. The server-side path that was built for it - the cloud finding the camera through the manufacturer's
  rendezvous servers - is gone: those servers stopped answering, and the cloud now reaches every Terp Cam over a
  relay the device it is paired at opens to the API (`cam_relay`, see `docs/device-protocol.md` §9). A standalone
  camera has no such device, so it has no path at all until one is found, and the server refuses to create one.
  The timelapse composer stores a `media` row with `render.status: queued`, which the hourly builder drains first.
- **Entitlement** (`PREMIUM_ENFORCED`; unset gates nothing, which is what a self-hosted install gets) is enforced
  in the image pipeline only: free cameras are **served** at a reduced width while full stills stay stored, so
  extending restores history; HD and whole-grow renders need entitlement and free renders carry a watermark.
  **Deleting a free camera's older stills is a switch of its own and is off by default**, so an install that says
  nothing keeps every picture exactly as long as it does today and only the served resolution and the renders
  depend on entitlement; turning it on applies the free windows. The reduced width and the free retention windows
  are **configuration, not constants**: this repository carries the mechanism and the hosted install its numbers.
  Nothing renews on its own; the admin route is the only writer. A camera answers `entitlement { validUntil,
  grant, tier, renewalVisible }`, and `/me` carries `premium { enforced, extendUrl, priceLabel }` from
  configuration, so the renewal notice and its button need no billing in this server.
- **How entitlement is granted.** Per camera, as the record decides, and for twelve months: a Terp Cam starts
  its year when it is **first claimed or paired** (`grant: included`), and every camera that exists at the
  migration, RTSP cameras included, starts its year on **migration day** (`grant: migration`). After the
  migration an RTSP camera has no included year of its own and is entitled only by purchase (`grant:
  purchase`), which is what the Premium screen says about a camera that is not a Terp Cam. A camera that is
  unpaired and paired again keeps the entitlement it has; the year is not restarted by re-pairing.
- **Age of a value.** `/live` answers every metric as `{ value, measuredAt, state }` from one Flux `last()` per
  device, with `state` from one shared constant `VALUE_AGE = { liveSeconds: 120, staleSeconds: 600 }` and the
  server's clock, so no client does the arithmetic. Values are dimmed, never hidden.
- **Notifications.** One send decision per person: mute, quiet hours in the person's time zone (critical still
  comes through), otherwise the channels the routing names. An alarm is two rows of that routing rather than
  one - `alerts` for a critical rule, wanted where it wakes somebody, and `warnings` for a warning one, read in
  the morning - and an info rule stays in the inbox and is announced on no row at all. The other three rows are
  raised by a loop rather than by an event: `tasks` when a rhythm comes round, `plan` when a recipe step stands
  waiting for somebody, and `weekly_timelapse` when a camera's week of pictures has closed - whose link is the
  app's own address, from `APP_URL_EXTERNAL`, and is left out where an install has not said where its app is
  served. E-mail and webhook as today, Web Push with a VAPID key pair in configuration, Telegram as one bot per
  install with a webhook guarded by a secret, where a reply to a message the bot sent becomes a note. Every
  channel is off until configured and the screen says so.
- **Exports.** A zip of somebody's grows, their CSVs and their photos does not finish inside a request, so both
  `GET /me/export` and `GET /grows/{id}/export` answer a job that is polled until its file is ready, and the file
  is a `media` row of its own kind: it lives in the bucket the pictures already use, it is served by the route
  that serves any other media, and the sweep that removes what nothing points at removes it too. No collection and
  no lifecycle of its own. *Amended 2026-09-22:* both answer `{ media, queued }`, 202 while the file is being
  built and 200 once it is ready; the row is the caller's alone, a finished export stands in for the next request
  for an hour, and the daily sweep removes it about a week later. Its bytes are handed to a session only, never to
  the long-lived picture token, so the app fetches them and makes the download itself.
- **Privacy.** The export above is "export everything". `DELETE /me` really
  deletes, in an order that can be resumed at boot; devices are unclaimed and stay claimable. Climate retention
  summarises the days about to leave the window into a `status_daily` measurement and then deletes the raw
  points; series older than the window are read from the summaries.
- **Demo.** A demo session reads every object with `isDemo`, redacted. `simulate-device.sh demo on` marks a
  device and everything attached to it; a `demo-seed` subcommand creates the demo grow with its public page.

## Firmware delta

Four files, all for item 11: `firmware/src/wifi.cpp`, `firmware/src/wifi.h`,
`firmware/src_hwtype/controller/controller.cpp`, `firmware/src_hwtype/fridge/fridge.cpp`, mirrored in
`scripts/simulate-device.mjs`. Nothing else in the firmware changes.

*Amended 2026-09-19 to 10-07:* a few more things changed, each additive or local to one device type and mirrored
in the simulator, and the server works with a build from either side of each:

- the fridge logs `message-ext-sensor-fail` and `message-ext-sensor-deviate` at most once every 15 minutes each,
  across a crash or a watchdog reboot too (Chris, 2026-09-19): the two lines were nearly all of the old device log;
- the laws below were sharpened (2026-10-02): an exhaust socket also runs on over-temperature in the standard
  mode, a controller's humidifier keeps the fridge's five-point minimum band, and a smart socket keeps to the
  protections it is set to;
- in germination a tent controller keeps its dehumidifier output off and a fridge's dehumidifier socket rests
  (2026-10-03, ADR 0007);
- the dryer hardware type is gone, its firmware and build environment included (Chris, 2026-10-02); migration 020
  deletes the dryers an install still holds with their readings and records, and their class with its builds, so
  a dryer that registers is refused;
- a device sends the settings it runs with on every `fetch` (2026-10-07, see "The device protocol").

- **Roles** gain `humidifier · exhaust · circulation · fan · pump · custom_timer · manual`; the empty role is
  "unassigned" and never driven.
- **New command** `{ action: "socket_override", slot | output: "light", state: on | off | auto, seconds }`. The
  override is a per-row value in RAM with an expiry, consulted before the timer and the role's target. It dies
  with a reboot, which is the failsafe. The firmware re-asserts every socket at least every 60 s, so nothing but
  the firmware can hold a socket on or off.
- **`socket_set` gains `timer { onS, everyS }`** for `pump` and `custom_timer`, stored in the socket's NVS row.
- **Three boot keys** through the unchanged `hardware-info:` sub-protocol: `socket_roles=<csv>`, `caps=<csv>`
  (`socket_override`, `socket_timer`, `light_override`) and `socket_pulse=<role>:<seconds>,...`. The server
  sends a command or a role only to a device that announced it. It cannot compare versions: the reported
  firmware version is the build's uuid, and old firmware drops an unknown command without a word. A device that
  reports none of the keys is sent nothing new, and its switches are drawn disabled with "needs the next
  controller firmware".
- **The socket report** grows from `role|id|ip` to `role|id|ip|state|override-or-timer` and is re-sent when a
  row's state changes, at most once per 30 s. A parser that reads three columns keeps working.
- **Control laws** (proposed here, accepted with the sign-off of 2026-09-19; finer controls, such as a least time
  between humidifier and dehumidifier, are a later topic): humidifier mirrors the dehumidifier hysteresis below
  the target, exhaust follows the cooling condition the temperature mode already computes, circulation and fan run
  whenever the controller is not off, pump and custom timer follow their own timer, manual is off unless
  overridden.

## Migration

### Tooling

Versioned migrations in `server/src/migrations/`, applied in order at boot **before** the server listens or
subscribes to MQTT, recorded in `migrations`, guarded by a lock so two instances cannot both run them. Each one
is resumable: it copies with upserts by `id`, so a run that was killed continues where it stopped. `npm run
migrate -- --dry-run` runs the transforms against a database and reports counts and rejects without writing.
The rehearsal runs against the database of the simulated stack, which `./simulate-device.sh` can fill with
devices of every type, history, cameras, diary entries, plans, alarms and share links in today's shapes. That
covers every transform but not the size and the oddities of the hosted database, so the real run is still taken
with a fresh `./backup.sh` in hand and its reject report read before the server is let back in.

*Amended 2026-09-19 to 09-23.* The migration was also rehearsed, and run for real, on restored copies of the
hosted database (the backup of 2026-09-19): no rejects, every `legacy_*` collection reconciled with its new one,
about two minutes for the whole run, and repeated restores gave identical counts. That met what the simulated
stack could not show - the alarms on outputs, the stageless plans, the flood of sensor-fault lines, the devices
nobody ever named - and each is a rule above or below now. `npm run migrate:check` runs the preflight alone, the
check to make days before an upgrade. `MIGRATION_LOCALE` (default `en`) names the language the migration writes
names in, because the old database records no language for an account; guessing one would leave every grower
renaming the same rows. **A correction is a new step** (2026-09-23): an install that has upgraded has recorded the
step it ran and never runs it again, so a correction to that step reaches nobody, while a new step runs on the
next boot with nothing to drop or re-run. `017-entry-credentials` is the model - it reads the new collection,
moves nothing aside, rehearses without writing, is idempotent and rejects rather than loops on a row it cannot
change. The steps added since 013 carry later decisions into data that is already migrated; every step is a file in
`server/src/migrations/steps/`, and the commands are in `server/src/migrations/README.md`.

### Procedure

For every collection that changes shape:

1. rename the old collection to `legacy_<name>` (a metadata operation, instant). This step is skipped when
   `legacy_<name>` already exists, so a run that was killed after the rename continues with the copy and never
   touches the legacy data again,
2. transform it into the new collection or collections,
3. compare counts and write the statistics and every rejected document to the migration record.

A row a transform cannot take **stops the run at that step**. The steps before it stay applied, the step itself is
not recorded, so the next run repeats it and stops again; going on anyway is something an operator says out loud
(`--allow-rejects`, or `MIGRATION_ALLOW_REJECTS=true` where a container's environment is set). A report that stops
nothing is not a safeguard: a rule that read a diary entry's flag as a deletion dropped every line every grower
had written, reported each one, and finished green.

Before any of this, the existing background job that moves picture bytes still stored inside old `images`
documents into the GridFS bucket is run to completion as a migration of its own, because it looks for those
documents under the collection's old name.

The old data is therefore untouched. The GridFS bucket with the picture bytes and InfluxDB are not rewritten at
all. A later migration, in the following release, drops the `legacy_*` collections.

### Transform rules

| Today | Becomes | Rule |
| --- | --- | --- |
| `users` | `users` | `username` → `email`, `user_id` → `id`, `password` → `passwordHash`; `createdAt` from the old document's ObjectId, which is the rule for every migrated document without a better date; new fields get their defaults; a duplicate `user_id` aborts the migration with a report, because today nothing prevents one. Every account lands on UTC, no zone having ever been stored, and on the language `MIGRATION_LOCALE` names (amended 2026-09-23) |
| `passwordtokens` | – | not migrated; they live for minutes |
| every collection | every collection | mongoose's `__v` and the `_id` it adds to each subdocument (alarms, plan steps, `cloudSettings`) are dropped; they are its bookkeeping, not data |
| `devices` | `devices` | renames; `configuration` parsed from its string, where an absent or empty string becomes `null` and an unparseable one becomes `null` with the original kept in the reject report; `hardwareInfo` → `state.hardware`; the three update settings (`firmwareSettings.autoUpdate`, `cloudSettings.autoFirmwareUpdate` and `cloudSettings.firmwareChannel`, of which the first two are deprecated) fold into the one `firmware.channel`; the two pending-firmware fields and the two update-channel fields fold into `firmware`; `owner_id: ''` → `ownerId: null` |
| `devices.recipe` | `plans` | one plan per device that has steps; `state.status` is `running` when `activeSince > 0`, else `stopped`; step durations keep their unit; `email`, `notifications` and `additionalInfo` become `notify`; the active step's `lastTimeApplied` and `notified` become `state.lastAppliedAt` and `state.confirmationNotifiedAt`, and the same two flags on inactive steps are dropped because the engine resets them on every step change |
| `devices.alarms[]` | `alarmRules`, `alerts` | one rule each; e-mail and webhook actions become `delivery.custom` unchanged; a triggered alarm also gets its open alert. An alarm on an output keeps watching it: `co2_valve` is the model's `co2` output, `dehumidifier` and `co2_valve` become `output_running` because that is what the old engine tripped them on, the other three become `output_level`, and the heater's thresholds are divided by a hundred - they were percentages of a fraction, and the model compares an output against the number the series carries |
| `devices.cloudSettings` + `hardwareInfo.webcam_*` | `cameras`, `devices.settings`, `devices.firmware` | one camera per device that has a stream, its kind from the stream's scheme; a device with stills but no stream today gets a retired camera (`removedAt` set), so no picture loses its link. *Amended 2026-09-23:* a camera is dated by its device's newest still (`state.lastStillAt`), not left at `null`, and one whose device was never named is called what the app calls a new one, "Terp Cam 1" or "Camera 2", numbered per owner and kind |
| each claimed device | `spaces` | one space per device, kind from the device type, name from the device; unclaimed devices get none. *Amended 2026-09-23:* a device that was never named - most of them - gives its place the name the app gives a new one, "Tent 1", "Fridge 1", "Place 1", numbered per owner and kind, rather than its id, which would have greeted most growers with a hex string. An install that already ran the step needs a follow-up step, and the safe test there is `name === deviceId`: a "looks like an id" test would rename names people chose |
| `devicelogs` | `entries` | `kind` and `source` from `categories`; `message-key:param` parsed into `message`; `data` into `values` (the six fixed measurements become readings); `images` → `mediaIds`; `deleted` dropped, and **no row is dropped with it**: deleting a line really removed it, and the old app sets the flag on every diary entry it writes, so it means "not interesting on the device card" and nothing else. Every row still in the collection is a line somebody kept, and reading the flag as a deletion would empty a grower's whole diary; human diary entries get the device's owner as author, since a device has had exactly one writer. *Amended 2026-09-19 to 09-23:* the old log is a mixture of device alerts, system messages, alarms and diary lines (Chris, 2026-09-19), so a row is classified by its category - alarm lines become alarms, recipe lines plan entries, lifecycle lines phases, rows with readings measurements, the diary's own lines notes and measurements, and everything else a `system` entry that no week card or report shows. Of the two lines a fridge repeats until somebody fixes the fault, `message-ext-sensor-fail` and `message-ext-sensor-deviate`, only the newest 100 per device are carried and the rest are counted as left behind (Chris, 2026-09-19): they were nearly all of the collection and say nothing a hundred of them do not. The old app's own English headings ("Plant log entry") are dropped from a line's text: they are the app's label, not the grower's words |
| lifecycle entries | `grows` with `phases[]` and one placement | cycles by the rule today's grow report uses (a new cycle on a stage-order rollback or a changed name); a running plan without lifecycle entries becomes a grow that starts with its step, but only where a step of that plan carries a stage - a plan whose steps carry none says nothing about what is growing and becomes no grow, which is what it was before the upgrade too, since the old app wrote a lifecycle entry only for a step with a stage on it. That is the ordinary shape of a plan: only the guided onboarding's reference plans ever wrote a stage. The device, its space and its running plan migrate either way, and the first climate preset applied to that space offers to start a grow. Migrated grows have no plants, because none were ever recorded |
| `images` | `media` | `jpeg` → `still`, `mp4` → `timelapse` with its window, `user/jpeg` → `photo`; stills and timelapses get the camera of their device, photos the space and, through their entry, the grow |
| `shares` | – | not migrated: old links stop working, and `shareLinks` starts empty |
| `chartpresets` | – | not migrated: saved chart views are made again in the new app |
| `recipetemplates` | `planTemplates` | names made unique per owner |
| `deviceclasses`, `devicefirmwares`, `devicefirmwarebinaries`, `claimcodes` | `deviceClasses`, `firmwares`, `firmwareBinaries`, `claimCodes` | renames only |

### Going back

**The way back is the backup.** There is no rollback command, and there deliberately is not one: a command that
undoes a migration is a second transform to get right, reached for exactly once, in the hour somebody is least
able to read what it says it will do. Restoring the dump is the operation an operator already knows, it puts back
the database that was actually there rather than one reconstructed from what a rename left behind, and it is the
only answer that also covers the mistakes a rollback never could - a run that finished and was wrong.

So `./backup.sh` is taken before the upgrade and **restored somewhere once, to prove it restores**, rather than
being trusted on the evening it is needed. An untested backup is a hope, and this is the release it would be
tested by.

The `legacy_*` collections still matter, for a different reason: they hold the old rows untouched under their old
names for one release, so a transform that got something wrong can be read against what it read, and put right by
hand without going anywhere near the backup. They are not a way back on their own - nothing renames them into
place again - they are the evidence. The same goes for the picture bytes, which are never rewritten: the first
step moves the inline ones into the bucket and everything after it reads them there by the same ids, and for as
long as `legacy_images` stands, the daily sweep and the timelapse thinning leave the pictures the migration
carried over alone.

A run that stopped part way is therefore not a state anything undoes. The steps before it stay applied and are
recorded, the step that stopped is not, and the next run repeats that step and continues - which is what each one
being resumable and upsert-keyed is for. What an operator decides in that hour is whether to let it continue or
to restore, and both are things they can say out loud.

### What an upgrade looks like

- **The hosted install:** a rehearsal on the simulated database (*amended 2026-09-23:* and on a restored copy of
  its own), a `./backup.sh` **restored once to prove it restores**, then a deploy in a quiet hour. The server is
  down for as long as the transforms run, about two minutes on that copy. Devices keep their broker connection;
  samples published while the server is down are not recorded.
- **Self-hosted installs:** the README's upgrade section - `./backup.sh`, `git pull`, `./migrate-check.sh` (the
  preflight, which writes nothing), `./up.sh`. The migration runs by itself.
- **Devices:** nothing. They see the same routes and the same topics before and after.

## Clients in this repository that move with the API

`scripts/simulate-device.mjs` (its HTTP half; its MQTT half is the device protocol and stays),
`fw-buildcontainer/cli.py` and the firmware deploy workflow, the firmware-check skill, the Garmin widget, the
server's contract tests, and the README. They change in the same pull request as the routes they call.
*Amended 2026-10-07 (#142):* the firmware deploy uploads to a server that may still run the API from before
`/v1`, so `cli.py` falls back to that server's routes when `/v1/sessions/automation` answers 404; the fallback
goes once no deployed server is older than `/v1`.

## What is kept and what is rewritten

- **Kept, and pointed at the new model:** the MQTT ingest, the broker auth backend, the plan engine, the alarm
  state machine, the camera poller and the direct camera path, the timelapse builder, the tunnel, mail, the
  firmware rollout, background work, the token service.
- **Rewritten:** every mongoose schema, every shape in `shared-types`, every controller and request schema
  outside the device protocol, the access guards, cleanup, demo redaction, and the contract tests.
- **New:** the migrations, the device-protocol module as an explicit boundary, spaces, grows, plants, entries,
  reminders and tasks, memberships and invites, cameras as records, media, alerts, share links, follows, the
  read models (home, overview, weeks, report, live), notifications, export and deletion, the fleet routes.

This is a rewrite of the server's HTTP and persistence layers around engines that stay.

## Order of delivery

Foundation first - the conventions, the contract's schemas, the migrations with their test on a database in the
old shapes, the device-protocol module, the engines on the new collections, sessions and `/me` - then one slice
per round of the design record, each with its screens. Delivered in that order between 2026-09-17 and 2026-10-04
and merged as #104; the table of slices that planned it is done and was removed.

## Risks

1. **The migration is the risk.** It touches every document once. What bounds it is a backup taken before the
   upgrade and **proved restorable**, the reject report that stops a run rather than colouring it green, the
   counts, and the `legacy_*` collections standing untouched beside the new ones so a transform that read
   something wrong can be read against what it read and put right by hand. There is no rollback command; going
   back means restoring, which is the operation that also covers the run that finished and was wrong. The
   migration test on a database in today's shape was part of the foundation, not of the end. Restored copies of the
   hosted database met its size and its oddities before the day and run clean (amended 2026-09-23; the record
   expected the rehearsal on simulated data alone); what changes in that database after its last copy is still
   met on the day itself, which is what the backup and the reject report are for.
2. **Old links and saved views stop working**, deliberately. Share links people have sent out resolve to
   nothing after the migration, and saved chart presets are gone. Nothing else outside this repository calls the
   API, and the Garmin widget moves to `/v1` with it.
3. **Reconstructed grows inherit the grow report's heuristics.** Two consecutive grows with the same name and
   no stage rollback merge. Migrated grows have no plants.
4. **Membership widens what a non-owner can do.** The `need` each route declares is the checklist, and the
   contract test asserts it per route.
5. **Read models cost queries.** The home of a club is a handful of Mongo queries plus one Flux query per
   device; week cards and the public page run one aggregate per week and controller on the first uncached hit.
6. **Cascading deletes are new to this server** and need their own specs.
7. **Control laws for the new socket roles are decided here, not by a screen.** They ship behind
   `socket_roles`, so a firmware that omits a role never offers it. A wrong law on a real tent is worse than no
   role - a humidifier that never stops soaks a room - so one tent with a real socket per new role is watched for
   a day or two before the roles reach a grower's controller; the firmware check only proves a build boots and
   updates. On 2026-10-02 the roles had not yet run on hardware.
8. **The standalone Terp Cam has no way in.** It ships as "coming soon" rather than as a tab that fails on a
   stranger's camera; with the rendezvous gone, finishing it needs a new path to a camera that stands at no
   device, not only a session with a camera on a desk.
9. **Retention can delete pictures** where today everything is kept for three years. It is off unless an
   install turns it on, so the risk is taken deliberately rather than by upgrading.
10. **Two new outward-facing surfaces**, Web Push and the Telegram webhook, both off until configured.
11. **Devices have no placement history** (found 2026-09-22). A device row knows only where it stands now, so
   grow series, week cards and exports miss a device that has since left the tent for the days it stood there.
   Fixing that needs placement history on devices, as grows have.

## Alternatives considered

- **Revision 1: everything additive.** Optional fields on the old collections, legacy shapes written forever,
  a mirror between camera settings and camera records, old routes kept beside new ones. Safe to roll back by
  construction, and rejected for exactly what it preserves: two names for every fact.
- **A new database instead of renaming collections aside.** Cleaner still, but the picture bytes would have to
  be copied, which is most of the disk.
- **Transforming documents in place.** No second copy, and nothing to read a wrong transform against afterwards;
  a run killed half-way leaves a collection in two shapes, with no way to tell which rows have been through it.
- **Keeping the old API beside `/v1` for a period.** Two APIs over one model double what has to be tested. A
  small read-only set for outside clients is a different question, see open question 1.
- **Plants as "strain × count" rows inside the grow.** Less to store, but a single plant then has no identity
  until it is split off, and a split harvest has to invent one.
- **Alerts paired from two log lines**, as the additive design did. An alert has a life of its own (open,
  silenced, resolved), which a document states and a pair of lines only implies.
- **Stored tasks.** The record allows either. Derived tasks have nothing to keep in sync.

## Open questions

Each with the assumption the design stood on until it was answered. What was settled on 2026-09-17 is in the
sections above, not here. All eleven were answered in Chris's sign-off of 2026-09-19: questions 3 and 4 in his
own words, the others by "Assume the rest is agreed", which made each assumption the answer.

1. **Does a Terp Cam's entitlement cover another camera in the same tent?** Assumed no: entitlement sits on the
   camera, as the record decides, so an RTSP camera beside an entitled Terp Cam is not entitled by it. Reading
   it per controller instead is one lookup in the tier function and changes nothing else. **Answered: no**, per
   camera (`server/src/modules/v1/camera/entitlement.service.ts`).
2. **Free-tier limits as configuration.** Assumed the served width and the free retention windows stay out of
   this public repository and live in the hosted install's configuration. **Answered: yes** -
   `PREMIUM_FREE_STILL_WIDTH`, `PREMIUM_FREE_RETENTION` (the switch, off unless set), `PREMIUM_FREE_STILL_DAYS`
   and `PREMIUM_FREE_TIMELAPSE_DAYS`, none of them given a number here.
3. **Control laws for the new socket roles.** Assumed as listed under "Firmware delta". **Answered: they stand
   for now**; finer controls, such as a least time between humidifier and dehumidifier, are a topic of their own
   and not part of the rewrite.
4. **The light row on the Devices tab.** Assumed its switch overrides the controller's own light output.
   **Answered otherwise:** a tent may be lit by the controller's dimmable output and by further light sockets,
   each to be controlled on its own, and the screen has to make that obvious. Built (2026-09-20) as a light
   section: the output with a dimmer - its brightness a key of the configuration, which every build reads, its
   hold an override sent only to a build that announced `light_override` - and every light socket under it.
5. **A human phase action on a tent with a running plan.** Assumed skip when the plan's next step carries the
   stage, pause otherwise, and the sheet says which before the tap. **Answered: as assumed.**
6. **Notification channels.** Assumed Web Push, a Telegram bot per install and a weekly link to the week's
   timelapse ship with the alarms slice, each off until configured. **Answered: as assumed**, and built that way.
7. **"Mute all" mutes critical alarms too**, for the person who tapped it only. Assumed yes. **Answered: yes.**
8. **Authors of migrated diary entries.** Assumed the device's owner, since a device has had exactly one
   writer. **Answered: the device's owner.**
9. **Migrated grows** merge when two consecutive cycles share a name, and carry no plants. Assumed acceptable.
   **Answered: acceptable.**
10. **How many feeds a week has.** Assumed from the feed reminder's rhythm, else the water reminder's, else
   three. **Answered: as assumed.**
11. **Invite codes.** Assumed one 8-character code for link, typed code and QR, with a rate-limited preview.
   **Answered: as assumed.**

Open since:

12. **Keep the standalone Terp Cam kind at all?** (2026-10-04) `terpcam_standalone` stays in the model, but no
   path reaches such a camera and the server refuses to create one (see "Cameras"). Whether to keep the kind is
   the owner's to decide.
13. **`GET /admin/logs`** is in the API above and its answer is in the contract (`AdminLogPage`), but the route
   was never built. Build it, or take it out of both?
