# ADR 0001: Data model and API for the app rewrite

- **Status:** accepted on 2026-09-17 (revision 3). The model, the API, the frozen device protocol, the
  migration, the single firmware change and the order of delivery are agreed; the questions left open at the
  end each carry the assumption the work proceeds on.
- **Date:** 2026-09-17
- **Touches:** `server/`, `shared-types/`, `firmware/` (smart sockets only), `scripts/simulate-device.mjs`,
  `fw-buildcontainer/`, `garmin/`

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
12. **RTSP cameras** through the controller; **standalone Terp Cams** without one.

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
`/v1` is served under the base URL that deployed firmware builds already carry; the migration is rehearsed
against the database of the simulated stack; old share links and saved chart presets are not migrated; a camera
gets twelve months of Premium when it is first claimed or paired, and every camera that exists at the migration
starts its twelve months on migration day; pairing a standalone Terp Cam from the phone ships as "coming soon"
and gets its own session once the rewrite is merged.

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
   aside and transformed into its new shape, so the old data stays untouched for one release as the way back.
4. **A frozen device protocol.** The firmware's HTTP routes and the whole MQTT protocol keep their exact shapes.
   One server module owns them and translates between the device's vocabulary and the model.
5. **One firmware change**, for smart sockets (item 11), gated by capabilities the device reports.

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
  contract keeps generating exactly what it generates today and goes when the Angular app does.
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
- **Reads answer 200.** Authentication is a bearer token; pictures additionally accept a short media token in
  the query string, as today.

## The model

Twenty-eight collections. "→" marks a reference. Every resource also has `id` and `createdAt`; a `state`
object is maintained by the server and read-only.

### Accounts

| Collection | Fields |
| --- | --- |
| `users` | `email` (unique), `passwordHash`, `isAdmin`, `isActive`, `activationCode`, `handle` (unique, the only name others ever see), `bio`, `avatarMediaId`, `publicProfile`, `privacy { hideWeights, hideCounts }`, `preferences { units, locale, timezone }`, `retention { climateDays }`, `notifications { channels, routing, quietHours, mutedUntil }`, `deletionStartedAt` |
| `sessions` | `userId`, `userAgent`, `lastSeenAt`, `expiresAt` (TTL). A session can be listed and revoked |
| `passwordResets` | `userId`, `tokenHash`, `expiresAt` (TTL) |
| `pushSubscriptions` | `userId`, `endpoint` (unique), `keys`, `userAgent` |
| `notificationLog` | `userId`, `channel`, `category`, `subject { type, id }`, `externalMessageId`, `sentAt`, `expiresAt` (TTL). What was sent to whom: it keeps a due task from being announced twice and maps a Telegram reply to what it answers |

No real name is stored. `notifications.routing` is the what-goes-where grid; `channels` holds the e-mail address,
the Telegram link and the webhook.

### Devices

| Collection | Fields |
| --- | --- |
| `devices` | `type`, `classId`, `serialNumber`, `ownerId`, `spaceId`, `name`, `mqtt { username, passwordHash }`, `firmware { channel, targetId }`, `configuration` (an object, or `null` before the device reported one; its schema belongs to the firmware of that type), `settings { vpdLeafOffsetDay, vpdLeafOffsetNight, ppfdLuxFactor }`, `isDemo`, `state { lastSeenAt, claimedAt, firmwareId, updateStartedAt, updateEndedAt, maintenanceUntil, hardware (the raw `hardware-info` report), socketStateChangedAt (slot → instant) }` |
| `deviceClasses` | `name`, `description`, `concurrentUpdates`, `maxFailures`, `firmwareIds { stable, beta, alpha }`, `rollout { paused, percent }` |
| `firmwares`, `firmwareBinaries` | `classId`, `name`, `version`, `wasStable` / `firmwareId`, `name`, `data` |
| `claimCodes` | `code` (unique), `deviceId` (unique) |
| `plans` | `deviceId` (unique), `templateId`, `name`, `steps[] { id, name, stage, preset, duration { value, unit }, settings, waitForConfirmation, confirmationMessage }`, `loop`, `notify { mode: off · on_step · on_confirmation, email, writeEntries }`, `state { status: running · paused · stopped · completed, activeStepIndex, stepStartedAt, pausedElapsedMs, pauseReason, lastAppliedAt, confirmationNotifiedAt }` |
| `planTemplates` | `ownerId`, `name` (unique per owner), `isPublic`, `steps[]` |
| `alarmRules` | `deviceId`, `name`, `metric`, `upper`, `lower`, `forSeconds`, `severity: critical · warning · info`, `origin: preset · always · device · human`, `presetId`, `enabled`, `cooldownSeconds`, `repeatSeconds`, `delivery { mode: routing · custom, custom }`, `silencedUntil`, `state { triggered, lastTriggeredAt, lastResolvedAt, extremeValue, lastSampleAt }` |
| `alerts` | `ruleId`, `deviceId`, `cameraId`, `spaceId`, `kind`, `severity`, `startedAt`, `resolvedAt`, `value`, `extremeValue` |

The device document keeps what the device is. What a human thinks about moves out: the plan, the alarm rules,
the camera. Today's `cloudSettings` dissolves: the firmware channel goes to `devices.firmware`, the VPD and PPFD
factors to `devices.settings`, the camera fields to `cameras`. Sockets and capabilities are typed views of
`devices.state.hardware`, served by the API and never stored twice. An alert is one document from trigger to
resolution, which is what the alerts inbox shows; today it has to be paired from two log lines. `delivery.mode:
custom` keeps today's per-alarm e-mail and webhook with its templates and the tunnel; `routing` uses the
person's notification settings.

### Places, people, grows

| Collection | Fields |
| --- | --- |
| `spaces` | `ownerId`, `kind: tent · fridge · room · balcony · other`, `name`, `roomId` (→ a space of kind `room`, one level), `presetPrompt: ask · never`, `retention { climateDays }`, `isDemo`, `archivedAt` |
| `memberships` | `spaceId`, `userId` (unique together), `role: can_log · can_manage`, `invitedBy`, `inviteId`. A membership on a room covers its spaces. The owner is `spaces.ownerId`, never a row |
| `invites` | `code` (unique, 8 characters from the claim-code alphabet), `spaceId`, `role`, `createdBy`, `expiresAt`, `revokedAt`, `state { useCount, lastUsedAt }` |
| `grows` | `ownerId`, `name`, `description`, `type: photoperiod · autoflower`, `phases[]`, `placements[]`, `scheme`, `measurements[]`, `visibility: private · public`, `slug` (unique), `coverMediaId`, `filmMediaId`, `startedAt`, `endedAt`, `isDemo`, `updatedAt` |
| `plants` | `growId`, `strain`, `label`, `status: active · harvested · ended`, `harvest { harvestedAt, wetWeightG, dryWeightG }` |
| `follows` | `userId`, `growId` (unique together) |

- **A plant is a document.** "Amnesia × 8" on the new-grow sheet creates eight plants labelled "Amnesia 1" to
  "Amnesia 8". Entries, cameras, phases and placements refer to plants by id, a split harvest selects plants,
  and a count is simply how many there are. Weights live on the plant and are stripped from shared views.
- **`Phase`** `{ id, stage, preset, startedAt, source: preset · plan · human, plantIds, deviceId, targets,
  setBy }`. `stage` is the six-value botanical stage. `preset` is the climate preset that was applied, such as
  `late_flowering`, which is how "Late flower" is drawn without a seventh stage. `plantIds: null` means every
  plant; a list is the scope of a split. `targets` is a snapshot of the controller's day and night targets,
  which gives charts a target band over a past phase (Influx stores sensors and outputs, never setpoints).
  `grows.phases[]` is the single truth for day counter, phase and the "auto" tag.
- **`Placement`** `{ id, spaceId, startedAt, endedAt, plantIds }`. `spaceId: null` is "no fixed place";
  `endedAt: null` is open. "4 drying in the fridge, 4 still flowering" is two open placements and a drying
  phase scoped to four plants.
- **`scheme`** `{ origin { type: asset · own, assetId, version, schemeId }, strength, waterEc, plantType,
  flipWeek, edited, grid }`. Shipped schemes are JSON assets in the client and the server never reads one, so
  the grow stores the effective grid. That also keeps a grow's history stable when a scheme is edited later.
- **`measurements[]`** `{ key, name, unit, perPlant, target, chart }`, the definitions of this grow.

### Diary, tasks, pictures

| Collection | Fields |
| --- | --- |
| `entries` | `kind: water · feed · photo · note · measurement · training · phase · move · harvest · visit · alarm · plan · system`, `occurredAt`, `source: human · device · plan · preset · alarm`, `authorId`, `growId`, `spaceId`, `deviceId`, `plantIds[]`, `cameraId`, `taskId`, `alertId`, `severity`, `text`, `message { key, params[] }`, `values` (typed per kind), `mediaIds[]`, `undoUntil` |
| `reminders` | `subject { type: grow · space, id }`, `kind: water · feed · chore · custom`, `label`, `everyDays`, `onceAt`, `assigneeId`, `defaults`, `createdBy` |
| `cameras` | `ownerId`, `kind: terpcam_controller · terpcam_standalone · rtsp`, `deviceId`, `spaceId`, `name`, `looksAt`, `plantIds[]`, `did`, `uid`, `ip`, `secret` (server only), `url`, `transport`, `tunnel`, `model`, `stillIntervalSeconds`, `nightOff`, `maintenanceOff`, `logErrors`, `entitlement { validUntil, grant }`, `isDemo`, `removedAt`, `state { lastStillAt, lastError, firmwareVersion }` |
| `media` | `kind: still · timelapse · photo · avatar`, `mime`, `bytes`, `cameraId`, `growId`, `spaceId`, `uploadedBy`, `capturedAt`, `endsAt`, `window: day · week · month · custom`, `quality`, `lengthSeconds`, `render` (composer options and status). Unique on `{cameraId, kind, window, capturedAt}` for camera media |
| `schemes` | `ownerId`, `name`, `origin { assetId, version }`, `grid` (a user's own feeding schemes) |
| `chartViews` | `ownerId`, `name`, `definition` (structured, not a query string) |
| `shareLinks` | `token` (unique, separate from `id`), `kind: view · public_page`, `subject { type: grow · space, id }`, `range { startsAt, endsAt }`, `includeCameras`, `createdBy`, `expiresAt`, `revokedAt`, `state { openCount, lastOpenedAt }` |
| `migrations` | `name`, `appliedAt`, `durationMs`, `stats` |

- **One timeline.** A human's watering, a device's log line and an alarm are all entries, told apart by `kind`
  and `source`. A device's `message-key:param` line is parsed once into `message { key, params }`. A human
  writes `text`. `values` has one schema per kind; readings of any kind share one shape, `values.readings:
  [{ key, value, plantId }]`, keyed by the grow's measurement definitions.
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
need:    own     claim and unclaim, delete a space, grow or camera, members, invites, share links, entitlement
         manage  configuration, alarm rules, plan, commands, sockets, camera settings, others' entries
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

## The API

Everything below is under `/v1`. Every route that exists today and is not part of the device protocol is
removed together with the Angular app.

| Area | Routes |
| --- | --- |
| Sessions | `POST /sessions` (log in), `POST /sessions/demo`, `POST /sessions/automation`, `POST /sessions/refresh`, `GET /sessions`, `DELETE /sessions/{id}` |
| Account | `POST /users` (sign up), `POST /users/activations`, `POST /password-resets`, `POST /password-resets/{token}/redemptions`, `GET/PATCH/DELETE /me`, `PUT /me/password`, `GET /me/export`, `POST/DELETE /me/push-subscriptions[/{id}]`, `POST /me/telegram-link` |
| Home | `GET /home` (one card per space: live values with age, setpoints, the grow with its newest entries, latest still, due tasks, open alerts, followed grows) |
| Spaces | `GET/POST /spaces`, `GET/PATCH/DELETE /spaces/{id}`, `PUT/DELETE /spaces/{id}/archive`, `GET /spaces/{id}/overview` (with the 24 h climate verdict), `GET /spaces/{id}/live`, `POST /spaces/{id}/preset-applications` |
| Members | `GET/POST /spaces/{id}/members`, `PATCH/DELETE /spaces/{id}/members/{userId}`, `GET/POST /spaces/{id}/invites`, `PUT /invites/{code}/revocation`, `DELETE /invites/{code}`, `GET /invites/{code}` (public preview), `POST /invites/{code}/acceptances` |
| Devices | `GET /devices`, `POST /devices/claims`, `GET/PATCH /devices/{id}`, `DELETE /devices/{id}/claim` (give the device up), `GET/PUT /devices/{id}/configuration`, `POST /devices/{id}/commands` (a typed union: reboot, maintenance, test, stop test, camera capture), `GET /devices/{id}/firmwares`, `GET /devices/{id}/live`, `GET /devices/{id}/series` |
| Sockets | `GET /devices/{id}/sockets`, `PUT/DELETE /devices/{id}/sockets/{slot}` (pair by address, role, timer; remove), `PUT/DELETE /devices/{id}/sockets/{slot}/override`, `POST /devices/{id}/sockets/{slot}/tests` |
| Plan | `GET/PUT/DELETE /devices/{id}/plan`, `POST /devices/{id}/plan/transitions` (confirm, skip, extend, pause, resume), `GET/POST /plan-templates`, `GET/PATCH/DELETE /plan-templates/{id}` |
| Alarms | `GET/POST /devices/{id}/alarm-rules`, `PATCH/DELETE /alarm-rules/{id}`, `PUT/DELETE /alarm-rules/{id}/silence`, `GET /alerts`, `GET /alerts/{id}` |
| Grows | `GET/POST /grows`, `GET/PATCH/DELETE /grows/{id}`, `GET/POST /grows/{id}/plants`, `PATCH/DELETE /plants/{id}`, `POST /grows/{id}/phases`, `PATCH/DELETE /grows/{id}/phases/{phaseId}`, `POST /grows/{id}/placements` (a move), `PATCH/DELETE /grows/{id}/placements/{placementId}`, `POST /grows/{id}/harvests`, `POST /grows/{id}/splits`, `GET /grows/{id}/weeks`, `GET /grows/{id}/report`, `GET /grows/{id}/series`, `GET /grows/{id}/export` |
| Diary | `GET/POST /entries`, `GET/PATCH/DELETE /entries/{id}`, `GET/POST /reminders`, `PATCH/DELETE /reminders/{id}`, `GET /tasks`, `POST /tasks/{id}/completions` |
| Cameras | `GET/POST /cameras`, `GET/PATCH/DELETE /cameras/{id}`, `POST /cameras/{id}/test-captures`, `GET /cameras/{id}/frames`, `GET/POST /cameras/{id}/timelapses` |
| Media | `POST /media` (a photo), `GET /media/{id}`, `GET /media/{id}/content`, `DELETE /media/{id}` |
| Schemes, charts | `GET/POST /schemes`, `PATCH/DELETE /schemes/{id}`, `GET/POST /chart-views`, `PATCH/DELETE /chart-views/{id}` |
| Sharing | `GET/POST /share-links`, `PATCH/DELETE /share-links/{id}`, `PUT /share-links/{id}/revocation`, `GET /shared/{token}` (resolve), `GET /follows`, `PUT/DELETE /follows/{growId}` |
| Public | `GET /public/grows/{slug}`, `GET /public/grows/{slug}/media/{id}`, `GET /public/grows/{slug}/card.png`, `GET /public/users/{handle}`; outside `/v1`, `GET /g/{slug}` and `GET /@{handle}` answer a small HTML shell with Open Graph tags |
| Admin | `GET/POST /admin/users`, `GET/PATCH/DELETE /admin/users/{id}`, `GET /admin/fleet`, `GET /admin/stats`, `GET /admin/logs`, `GET/POST /admin/devices`, `GET/POST /admin/device-classes`, `PATCH /admin/device-classes/{id}`, `GET/POST /admin/firmwares`, `PATCH/DELETE /admin/firmwares/{id}`, `PUT /admin/firmwares/{id}/binaries/{name}`, `PUT /admin/cameras/{id}/entitlement` |

`GET /healthz` and `GET /readyz` replace `/` and `/readycheck`; the compose health check moves with them.

## Behaviour the model implies

- **Day counter, phase, "auto".** Computed once in the grow serialiser from `phases[]`: `day = floor((now -
  phases[0].startedAt) / 1 d) + 1`; a plant's phase is the latest phase whose scope includes it; the headline is
  the largest plant group, and the groups are listed when they differ; `auto` is `source` in `{preset, plan}`.
- **One phase writer.** `GrowService.setPhase` is called by the grow routes, the plan engine and
  `preset-applications`. It appends the phase, writes the `phase` entry and re-reads stage-bound alarm
  thresholds from one table in `shared-types`. Applying a preset to a space with an open grow sets its phase;
  without one the answer says so, and the client offers "start a grow here", "move a grow here" or "only
  climate". Nothing is created by a controller merely being on.
- **The plan engine** keeps its 20 s tick, its hourly re-apply and its mails, and reads `plans` instead of a
  field on the device. Pause, resume, skip, confirm and extend are transitions of `plans.state`. Because the
  engine re-applies its step hourly, a preset applied beside a running plan would be undone: when the plan's
  next step carries the requested stage the action becomes a skip, otherwise the plan pauses and the preset is
  applied.
- **The alarm engine** keeps its state machine and reads `alarmRules`. A trigger opens an `alert` and writes an
  entry; a resolution closes it. A health loop evaluates the `offline` metric from `lastSeenAt` and raises an
  alert for a camera that stopped delivering stills.
- **Cameras.** The poller, the timelapse builder, thinning and retention iterate `cameras`. When a device
  reports a paired Terp Cam over MQTT, the protocol module upserts its camera row. A controller still pairs
  exactly one Terp Cam; "several cameras per tent" is that camera plus RTSP cameras pulled through the
  controller's existing tunnel plus standalone Terp Cams the cloud reaches itself, none of which needs firmware.
  Creating an RTSP camera is never refused. **Pairing a standalone Terp Cam ships as "coming soon"**: the model,
  the camera kind and the server-side path to reach such a camera are built, the tab that would pair one says it
  is coming, and the flow is finished in its own session once the rewrite is merged, because it needs a camera
  on a desk to prove it. The timelapse composer stores a `media` row with `render.status:
  queued`, which the hourly builder drains first.
- **Entitlement** (`PREMIUM_ENFORCED`; unset gates nothing, which is what a self-hosted install gets) is
  enforced in the image pipeline only: free cameras are **served** at a reduced width while full stills stay
  stored, so extending restores history; HD and whole-grow renders need entitlement and free renders carry a
  watermark. **Deleting a free camera's older stills is a switch of its own and is off by default**, so an
  install that says nothing keeps every picture exactly as long as it does today and only the served resolution
  and the renders depend on entitlement; turning it on applies the free windows. The reduced width and the free retention windows are **configuration,
  not constants**: this repository carries the mechanism and the hosted install its numbers. Nothing renews on
  its own; the admin route is the only writer. A camera answers `entitlement { validUntil, grant, tier,
  renewalVisible }`, and `/me` carries `premium { enforced, extendUrl, priceLabel }` from configuration, so the
  renewal notice and its button need no billing in this server.
- **How entitlement is granted.** Per camera, as the record decides, and for twelve months: a Terp Cam starts
  its year when it is **first claimed or paired** (`grant: included`), and every camera that exists at the
  migration, RTSP cameras included, starts its year on **migration day** (`grant: migration`). After the
  migration an RTSP camera has no included year of its own and is entitled only by purchase (`grant:
  purchase`), which is what the Premium screen says about a camera that is not a Terp Cam. A camera that is
  unpaired and paired again keeps the entitlement it has; the year is not restarted by re-pairing.
- **Age of a value.** `/live` answers every metric as `{ value, measuredAt, state }` from one Flux `last()` per device,
  with `state` from one shared constant `VALUE_AGE = { live: 120 s, stale: 600 s }` and the server's clock, so no
  client does the arithmetic. Values are dimmed, never hidden.
- **Notifications.** One send decision per person: mute, quiet hours in the person's time zone (critical still
  comes through), otherwise the channels the routing names. E-mail and webhook as today, Web Push with a VAPID
  key pair in configuration, Telegram as one bot per install with a webhook guarded by a secret, where a reply
  to a message the bot sent becomes a note. Every channel is off until configured and the screen says so.
- **Exports.** A zip of somebody's grows, their CSVs and their photos does not finish inside a request, so both
  `GET /me/export` and `GET /grows/{id}/export` answer a job that is polled until its file is ready, and the file
  is a `media` row of its own kind: it lives in the bucket the pictures already use, it is served by the route
  that serves any other media, and the sweep that removes what nothing points at removes it too. No collection
  and no lifecycle of its own.
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
- **Proposed control laws:** humidifier mirrors the dehumidifier hysteresis below the target, exhaust follows
  the cooling condition the temperature mode already computes, circulation and fan run whenever the controller
  is not off, pump and custom timer follow their own timer, manual is off unless overridden.

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

### Procedure

For every collection that changes shape:

1. rename the old collection to `legacy_<name>` (a metadata operation, instant). This step is skipped when
   `legacy_<name>` already exists, so a run that was killed after the rename continues with the copy and never
   touches the legacy data again,
2. transform it into the new collection or collections,
3. compare counts and write the statistics and every rejected document to the migration record.

Before any of this, the existing background job that moves picture bytes still stored inside old `images`
documents into the GridFS bucket is run to completion as a migration of its own, because it looks for those
documents under the collection's old name.

The old data is therefore untouched. The GridFS bucket with the picture bytes and InfluxDB are not rewritten at
all. A later migration, in the following release, drops the `legacy_*` collections.

### Transform rules

| Today | Becomes | Rule |
| --- | --- | --- |
| `users` | `users` | `username` → `email`, `user_id` → `id`, `password` → `passwordHash`; `createdAt` from the old document's ObjectId, which is the rule for every migrated document without a better date; new fields get their defaults; a duplicate `user_id` aborts the migration with a report, because today nothing prevents one |
| `passwordtokens` | – | not migrated; they live for minutes |
| every collection | every collection | mongoose's `__v` and the `_id` it adds to each subdocument (alarms, plan steps, `cloudSettings`) are dropped; they are its bookkeeping, not data |
| `devices` | `devices` | renames; `configuration` parsed from its string, where an absent or empty string becomes `null` and an unparseable one becomes `null` with the original kept in the reject report; `hardwareInfo` → `state.hardware`; the three update settings (`firmwareSettings.autoUpdate`, `cloudSettings.autoFirmwareUpdate` and `cloudSettings.firmwareChannel`, of which the first two are deprecated) fold into the one `firmware.channel`; the two pending-firmware fields and the two update-channel fields fold into `firmware`; `owner_id: ''` → `ownerId: null` |
| `devices.recipe` | `plans` | one plan per device that has steps; `state.status` is `running` when `activeSince > 0`, else `stopped`; step durations keep their unit; `email`, `notifications` and `additionalInfo` become `notify`; the active step's `lastTimeApplied` and `notified` become `state.lastAppliedAt` and `state.confirmationNotifiedAt`, and the same two flags on inactive steps are dropped because the engine resets them on every step change |
| `devices.alarms[]` | `alarmRules`, `alerts` | one rule each; e-mail and webhook actions become `delivery.custom` unchanged; a triggered alarm also gets its open alert |
| `devices.cloudSettings` + `hardwareInfo.webcam_*` | `cameras`, `devices.settings`, `devices.firmware` | one camera per device that has a stream, its kind from the stream's scheme; a device with stills but no stream today gets a retired camera (`removedAt` set), so no picture loses its link |
| each claimed device | `spaces` | one space per device, kind from the device type, name from the device |
| `devicelogs` | `entries` | `kind` and `source` from `categories`; `message-key:param` parsed into `message`; `data` into `values` (the six fixed measurements become readings); `images` → `mediaIds`; `deleted` dropped, because what it really meant was "not interesting on the device card": the entries that carry it are configuration diffs and manual plan activations, which become `system` and `plan` entries that the diary does not show by default, so nothing a grower hid becomes visible; human diary entries get the device's owner as author, since a device has had exactly one writer |
| lifecycle entries | `grows` with `phases[]` and one placement | cycles by the rule today's grow report uses (a new cycle on a stage-order rollback or a changed name); a running plan without lifecycle entries becomes a grow that starts with its step; migrated grows have no plants, because none were ever recorded |
| `images` | `media` | `jpeg` → `still`, `mp4` → `timelapse` with its window, `user/jpeg` → `photo`; stills and timelapses get the camera of their device, photos the space and, through their entry, the grow |
| `shares` | – | not migrated: old links stop working, and `shareLinks` starts empty |
| `chartpresets` | – | not migrated: saved chart views are made again in the new app |
| `recipetemplates` | `planTemplates` | names made unique per owner |
| `deviceclasses`, `devicefirmwares`, `devicefirmwarebinaries`, `claimcodes` | `deviceClasses`, `firmwares`, `firmwareBinaries`, `claimCodes` | renames only |

### Going back

`npm run migrate:rollback` drops the new collections and renames `legacy_*` back, after which the previous
release runs on exactly the data it left. Whatever was written after the migration is lost in that case; picture
bytes written meanwhile become orphans, which the existing sweep removes. Once the `legacy_*` collections are
dropped, the way back is the backup.

### What an upgrade looks like

- **The hosted install:** a rehearsal on the simulated database, a `./backup.sh`, then a deploy in a quiet
  hour. The server is down for as long as the transforms run. Devices keep their broker connection; samples
  published while the server is down are not recorded.
- **Self-hosted installs:** `git pull` and `docker compose up --build` as today. The migration runs by itself.
  The README's upgrade section gains one sentence: run `./backup.sh` first.
- **Devices:** nothing. They see the same routes and the same topics before and after.

## Clients in this repository that move with the API

`scripts/simulate-device.mjs` (its HTTP half; its MQTT half is the device protocol and stays),
`fw-buildcontainer/cli.py` and the firmware deploy workflow, the firmware-check skill, the Garmin widget, the
server's contract tests, and the README. They change in the same pull request as the routes they call.

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

| Step | What lands |
| --- | --- |
| 0 Foundation | conventions, the `shared-types` schemas, the migrations with every transform and the migration test on a database in today's shape, the device-protocol module, the engines pointed at the new collections, sessions and `/me`, the simulator and the build CLI on `/v1` |
| 1 Shell and home | spaces, `access()`, `/home`, `/live` |
| 2 Grow and tent pages | grows, plants, `/weeks`, `/overview` with the verdict |
| 3 Logging | entries, photo upload, the Undo window |
| 4 Timeline | camera read routes, `/frames`, phase target bands |
| 5 Devices | `/devices`, camera create and settings, the composer, sockets on the server and in the firmware |
| 6 Public diary | `visibility` and `slug`, the public routes, the card, share links with the range clamp |
| 7 Lifecycle | phases, placements, harvests, splits, preset applications |
| 9 Controller | the plan routes and transitions |
| 10 Alarms, tasks, notifications | alarm rules, alerts, the health loop, reminders and tasks, the send decision and its channels |
| 11 Onboarding | claims, `demo-seed`; the standalone camera path is built to the point where the tab says "coming soon" |
| 12 Measurements and charts | measurement definitions, grow series, export, schemes, chart views |
| 13 Sharing | memberships, invites |
| 14 Account, entitlement, admin | the entitlement gate, export, deletion, climate retention, the fleet routes, staged rollout |

Step 8 (visual direction) needs no backend. Step 0 is large, because the engines have to run on the new model
before the first screen can show a live value.

## Risks

1. **The migration is the risk.** It touches every document once. The counts and the reject report, the
   untouched `legacy_*` collections and the rollback command are what bound it. The migration test on a
   database in today's shape is part of step 0, not of the end. The rehearsal runs on simulated data, so the
   size of the hosted database and whatever is odd in it are met for the first time on the day itself; that is
   what the backup and the reject report are for.
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
   `socket_roles`, so a firmware that omits a role never offers it.
8. **The standalone Terp Cam flow is unproven end to end** and therefore ships as "coming soon" rather than
   as a tab that fails on a stranger's camera.
9. **Retention can delete pictures** where today everything is kept for three years. It is off unless an
   install turns it on, so the risk is taken deliberately rather than by upgrading.
10. **Two new outward-facing surfaces**, Web Push and the Telegram webhook, both off until configured.

## Alternatives considered

- **Revision 1: everything additive.** Optional fields on the old collections, legacy shapes written forever,
  a mirror between camera settings and camera records, old routes kept beside new ones. Safe to roll back by
  construction, and rejected for exactly what it preserves: two names for every fact.
- **A new database instead of renaming collections aside.** Cleaner still, but the picture bytes would have to
  be copied, which is most of the disk.
- **Transforming documents in place.** No second copy, and no way back but a restore; a run killed half-way
  leaves a collection in two shapes.
- **Keeping the old API beside `/v1` for a period.** Two APIs over one model double what has to be tested. A
  small read-only set for outside clients is a different question, see open question 1.
- **Plants as "strain × count" rows inside the grow.** Less to store, but a single plant then has no identity
  until it is split off, and a split harvest has to invent one.
- **Alerts paired from two log lines**, as the additive design did. An alert has a life of its own (open,
  silenced, resolved), which a document states and a pair of lines only implies.
- **Stored tasks.** The record allows either. Derived tasks have nothing to keep in sync.

## Open questions

Each with the assumption the design stands on until it is answered. What was settled on 2026-09-17 is in the
sections above, not here.

1. **Does a Terp Cam's entitlement cover another camera in the same tent?** Assumed no: entitlement sits on the
   camera, as the record decides, so an RTSP camera beside an entitled Terp Cam is not entitled by it. Reading
   it per controller instead is one lookup in the tier function and changes nothing else.
2. **Free-tier limits as configuration.** Assumed the served width and the free retention windows stay out of
   this public repository and live in the hosted install's configuration.
3. **Control laws for the new socket roles.** Assumed as listed under "Firmware delta".
4. **The light row on the Devices tab.** Assumed its switch overrides the controller's own light output.
5. **A human phase action on a tent with a running plan.** Assumed skip when the plan's next step carries the
   stage, pause otherwise, and the sheet says which before the tap.
6. **Notification channels.** Assumed Web Push, a Telegram bot per install and a weekly link to the week's
   timelapse ship with step 10, each off until configured.
7. **"Mute all" mutes critical alarms too**, for the person who tapped it only. Assumed yes.
8. **Deleting an account that owns a space with members.** Assumed the members are removed and the space
   deleted; the alternative refuses until the members are removed by hand.
9. **Authors of migrated diary entries.** Assumed the device's owner, since a device has had exactly one
   writer.
10. **Migrated grows** merge when two consecutive cycles share a name, and carry no plants. Assumed acceptable.
11. **How many feeds a week has.** Assumed from the feed reminder's rhythm, else the water reminder's, else
   three.
12. **A stale alert out of the box.** Assumed opt-in beside the always-on offline alarm.
13. **Invite codes.** Assumed one 8-character code for link, typed code and QR, with a rate-limited preview.
