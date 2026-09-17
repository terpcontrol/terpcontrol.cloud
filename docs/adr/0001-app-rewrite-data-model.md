# ADR 0001: Data model and backend delta for the app rewrite

- **Status:** proposed, awaiting sign-off. Nothing in the new app is built before this is agreed.
- **Date:** 2026-09-17
- **Touches:** `server/`, `shared-types/`, `firmware/` (smart sockets only), `scripts/simulate-device.mjs`

## Context

The web app is being rewritten from scratch in React against a set of decided screens. The decision record and
the screens themselves are kept with the company documents; this ADR records only what they require of the
server, the wire shapes and the firmware. The record lists twelve things the screens assume and leaves the
choice of the minimum to this document:

1. A **space** (tent, fridge, room, balcony, no fixed place) that is not a device, with optional room grouping.
2. A **grow**: plants, photoperiod or autoflower, phases with a source, time-ranged links to spaces, a feeding
   scheme with overrides, reminders, visibility and privacy, a cover image.
3. An **entry**: today's device log with optional grow, plant and space references, an author, a kind and
   structured values.
4. A **task**, derived or stored.
5. **Membership** per space or room with two roles, and invite links.
6. A **camera** as its own record with an entitlement date, several per tent.
7. **Measurement definitions** per grow; feeding **schemes** as client assets with per-grow overrides.
8. A **share** keyed by grow or space with a time range; a public page and a link card.
9. **Follow**, user to grow.
10. The manual stage picker writes the same lifecycle entry the grow plan writes.
11. More **socket roles** and per-socket timed overrides that reach the firmware.
12. **RTSP cameras** through the controller; **standalone Terp Cams** without one.

Rules of the record that bind the model: no persona or mode selection; Premium covers camera images only,
never control, charts, diary or alarms; every value carries an age (live under 2 min, stale 2 to 10 min,
offline after 10 min, dimmed and never hidden); grows exist without devices and devices without grows; no
location is stored; harvest weights can be logged and are hidden in shared views by a setting; no comments, no
feed, no directory.

### What exists today

- The **device is the only container.** Name, owner, alarms, the running grow plan (`devices.recipe`), the one
  camera (`cloudSettings.rtspStream` plus hints) and the socket table (`hardwareInfo`) all hang off the device
  document. There is no space, room, grow, plant, membership, follow or entitlement anywhere in the code.
- The **diary is `devicelogs`**: keyed by `device_id`, no author, the kind encoded in `categories`, free-form
  `data`. A grow cycle is reconstructed in the client from `diary-plant-lifecycle` entries. "Day in stage" comes
  from `recipe.activeSince`, "day of grow" from those entries: two clocks that agree only while a plan runs.
- **One owner per device** (`devices.owner_id`), share links are read-only and keyed by device, and their time
  window lives in an unenforced `query` string.
- **One camera per device.** Stills and timelapses are keyed by device under a unique index
  `{device_id, format, timestamp, duration}`; timelapse windows are looked up by their exact period start.
- **Five socket roles**, fixed in shared types, server validation and firmware. The firmware re-asserts every
  socket to its computed target at least every 60 s, so nothing but the firmware can hold a socket on or off.
- **No migration tooling.** The house style is an optional field, a read-time normaliser and an idempotent
  boot-time backfill (`device-firmware.service.ts`, `legacy-image-data.migration.ts`).
- Clients that must keep working unchanged: firmware in the field, `scripts/simulate-device.mjs`, the Garmin
  widget, the Angular app until it is retired, and self-hosted installs that upgrade without reading anything.

### How the design was reached

Five independent proposals were written from different angles (smallest diff, derive at read time, no firmware
change, migration safety, clean domain) and scored by four reviewers on minimal change, completeness against
the record, migration safety and firmware impact. The migration-safety proposal won; its defects were fixed and
the best ideas of the others grafted in. The result was then checked element by element against every decided
screen, which added what the screens draw beyond the twelve items (alarm severity, notification channels,
export and deletion, the admin fleet table).

## Principles

1. **Additive, normalised, backfilled.** Nothing existing is renamed, re-typed or removed. Every reference is a
   string id joined by equality, as today. Every new field is optional and read through a normaliser. Every
   backfill is idempotent, runs at boot and then hourly, and is a no-op once nothing matches.
2. **Rollback-safe.** A previous server ignores the new collections and fields. `alarms[]` and `recipe` are
   written as whole subdocuments by old servers and old clients, so every new field inside them is a
   re-derivable cache and never the only copy. A paused plan is `activeSince: 0`, which every old reader
   understands as stopped.
3. **Existing contracts frozen.** Every route, guard, status code, MQTT topic and `hardware-info` key keeps its
   shape. The React app gets new routes beside the old ones, never instead of them.
4. **One truth per fact.** `grows.phases[]` for day counter, phase and the "auto" tag; `cameras` for polling,
   timelapses and entitlement; `cloudSettings.rtspStream` stays a write-through mirror of one camera per device
   until the Angular app is retired.
5. **Read models where a screen needs one query or raw-sample maths**; thin CRUD everywhere else. Tasks are
   derived, never stored.
6. **Firmware for item 11 only**, gated by capabilities the device reports, never by a version compare:
   `hardwareInfo.firmware_version` is the build's uuid and cannot be ordered, and old firmware drops an unknown
   command silently.
7. **Absent, never `null`.** An optional reference on an existing collection is omitted when it does not apply.
   The cleanup sweeps run `distinct` plus `$in`, and a `$in` containing `null` also matches missing fields.
8. **A control that cannot work is shown disabled with the reason**, never faked.

## The model

Ids are `uuidv4()` strings, timestamps epoch milliseconds (`devicelogs.time` stays a `Date`). `origin` fields
exist only to make a backfill idempotent and are never serialised. "Req" means mongoose `required`.

### New collection `spaces`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `space_id` | String, unique | yes | |
| `owner_id` | String → `users.user_id`, indexed | yes | members are added through `memberships` |
| `kind` | `tent · fridge · room · balcony · other` | yes | any kind may hold devices, cameras and grows; a `room` also groups other spaces |
| `name` | String ≤ 60 | yes | |
| `room_id` | String → a space of kind `room`, sparse index | no | one level only |
| `presetPrompt` | `ask · never` | no | "ask again / never" when a preset is applied with no open grow |
| `reminders[]` | `Reminder` | no | chores of the tent, e.g. "clean the carbon filter every 30 d" |
| `retention.climateDays` | Number | no | owner only, overrides the owner's default for the controllers placed here |
| `demo` | Boolean | no | propagated from `devices.demoDevice` |
| `origin.device_id` | String, unique sparse | no | set only by the space backfill |
| `createdAt`, `archivedAt` | Number | yes / no | archived, never deleted while anything points at it |

"No fixed place" is a grow whose link has `space_id: null`. It is not a space and never becomes a home card.

### New collection `grows`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `grow_id` | String, unique | yes | |
| `owner_id` | String, indexed | yes | |
| `name`, `description` | String ≤ 80 / ≤ 2000 | yes / no | the description is the author's own text on the public page |
| `type` | `photoperiod · autoflower` | no | default `photoperiod` |
| `plants[]` | `Plant` | no | a backfilled grow has none |
| `phases[]` | `Phase` | no | the truth for day counter, phase and "auto" |
| `spaceLinks[]` | `SpaceLink` | no | time-ranged, per plant subset after a split |
| `scheme` | `SchemeRef` | no | |
| `measurements[]` | `MeasurementDefinition` | no | |
| `reminders[]` | `Reminder` | no | |
| `visibility` | `private · public`, indexed | no | public means a permanent page and a place on the profile |
| `slug` | String, unique sparse | no | minted when first public, never changed |
| `cover_image_id`, `film_image_id` | String → `images.image_id` | no | the film is a rendered whole-grow video |
| `startedAt`, `endedAt` | Number | yes / no | `startedAt` mirrors `phases[0].since`; ending archives |
| `demo`, `origin {device_id, cycle_start}` | Boolean / unique sparse compound | no | `origin` only from the grow backfill |

Embedded shapes:

- **`Plant`** `{ plant_id, strain, count ≥ 1, name?, status: active · harvested · ended, harvest?: { at,
  wetWeightG?, dryWeightG? } }`. A row is "strain × count". Splitting by count is the primitive: harvesting 4 of
  a row of 8 yields `{count: 4, harvested}` and `{count: 4}`. A plant with its own page is a row with
  `count: 1`. Weights live only here and on `harvest` entries and are stripped from shared views.
- **`Phase`** `{ phase_id, stage, preset?, since, source: preset · plan · human, plant_ids?, entry_id?,
  device_id?, targets?, by? }`. `stage` is the existing six-value `DiaryLifecycleStage`, unchanged.
  `preset` is a label such as `late_flowering`: "Late flower" is a preset of the flowering stage, not a seventh
  stage, so old readers never meet an unknown value. `plant_ids` absent means every plant; set, it is the scope
  of a split. `targets` is a snapshot of the controller's day and night targets, which gives charts a target
  band over a past phase (Influx stores sensors and outputs, never setpoints).
- **`SpaceLink`** `{ link_id, space_id | null, from, to?, plant_ids? }`. An open link has no `to`. "4 drying in
  the fridge, 4 still flowering" is two open links with disjoint `plant_ids` and a drying phase scoped to the
  first four.
- **`SchemeRef`** `{ asset_id?, version?, own_scheme_id?, strength, waterEc?, plantType, flipWeek?, edited,
  grid }` with `grid = { weeks, products: [{ name, unit, mlPerL[] }], ecTarget?[] }`. Shipped schemes are client
  JSON assets and the server never reads one, so the client always sends the effective grid. Without it the
  server could not label a feeding task or count a week's feeds.
- **`MeasurementDefinition`** `{ key, name, unit, perPlant, target?: { min?, max?, fromScheme?, relative? },
  chart, template? }`. The six legacy diary measurements map onto built-in templates.
- **`Reminder`** `{ reminder_id, kind: water · feed · chore · custom, label, everyDays?, onceAt?, assignee_id?,
  defaults?, created_by, createdAt }`.

### New collection `cameras`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `camera_id` | String, unique | yes | |
| `owner_id` | String, indexed | yes | |
| `kind` | `terpcam_controller · terpcam_standalone · rtsp` | yes | |
| `device_id` | String, indexed | no | the paired controller, or the controller whose tunnel pulls an RTSP stream; absent for standalone |
| `space_id` | String, indexed | no | defaults to the device's space |
| `name`, `looksAt`, `plant_ids` | String / String / [String] | no | |
| `did`, `uid`, `ip` | String; `{device_id, did}` unique sparse | no | Terp Cam identity, written by the reconcile from `hardwareInfo.webcam_*` |
| `pwd` | String | no | server-only, stripped from every answer |
| `url`, `transport`, `tunnel`, `model` | | no | today's `rtspStream`, `rtspStreamTransport`, `tunnelRtspStream`, `webcamModel`; URL credentials redacted in answers |
| `stillIntervalS`, `nightOff`, `maintenanceOff`, `logErrors` | | no | |
| `premium_until`, `premium_grant` | Number / `included · migration · purchase · admin` | no | absent means never entitled |
| `lastStillAt`, `lastError`, `firmwareVersion` | | no | caches written by the poller and the direct path |
| `legacy_mirror` | Boolean, unique partial on `{device_id}` where true | no | the one camera per device mirrored into `cloudSettings` |
| `demo`, `origin`, `createdAt`, `removedAt` | | | unpairing sets `removedAt`; stills keep their `camera_id` until retention |

### New collections `memberships`, `invites`, `follows`

- **`memberships`** `{ membership_id, space_id, user_id, role: can_log · can_manage, invited_by?, invite_id?,
  since }`, unique on `{space_id, user_id}`. A membership on a room covers every space with that `room_id`. The
  owner is `spaces.owner_id` and never a row.
- **`invites`** `{ invite_id, code (unique, 8 characters from the claim-code alphabet), space_id, role,
  created_by, createdAt, expiresAt?, revokedAt?, useCount, lastUsedAt? }`. One code serves the link, the typed
  code and the QR.
- **`follows`** `{ user_id, grow_id, since }`, unique on the pair. A grow made private keeps its rows, which
  resolve to nothing until it is public again.

### Changed collections (every change additive)

- **`devices`**: `space_id` (absent = never placed, `null` = deliberately unplaced, string = placed);
  `recipe.pausedElapsedMs`, `pausedStepIndex`, `pausedReason`, `template_id`, `steps[].preset`;
  `alarms[].severity`, `source`, `preset_id`, `silencedUntil`, `channels`, and `sensorType` gains `offline`;
  `socketStateSince` (slot → epoch, for "offline 3 h" on a socket row).
- **`devicelogs`** (the entries): `device_id` relaxed to optional; `author_id`, `grow_id`, `plant_ids`,
  `space_id`, `kind`, `source`, `values`, `camera_id`, `task_id`, `undoUntil`; indexes `{grow_id, time}`,
  `{space_id, time}`, sparse `task_id`. `kind` is one of `water · feed · photo · note · measurement · training ·
  phase · move · harvest · visit · system · alarm · plan`. `values` is typed per kind; readings of any kind
  share one shape, `values.readings: [{ key, value, plant_id? }]`, keyed by the grow's measurement definitions.
- **`images`**: `camera_id`, `grow_id`, `quality`, `lengthS`, `render` (composer options and status),
  `duration` gains `custom`, `device_id` relaxed to optional, and **the one index swap**: the unique
  `{device_id, format, timestamp, duration}` is replaced by a unique partial `{camera_id, format, timestamp,
  duration}` (where `camera_id` exists) and a non-unique device index with a different key order.
- **`shares`**: `device_id` relaxed to optional; `kind: legacy · public_page · view`, `grow_id`, `space_id`,
  `from`, `to`, `cams`. `page`, `editable`, `charts` and `query` stay as the legacy contract.
- **`users`**: `handle` (unique sparse, the only name others ever see), `bio`, `publicProfile`, `privacy
  { hideWeights, hideCounts }`, `retention`, `notificationChannels` (channels, the what-goes-where grid, quiet
  hours, mute), `pushSubscriptions[]`, `notifiedTasks[]`, `sessions[]`, `units`, `locale`, `timezone`,
  `schemes[]` (own feeding schemes, embedded), `avatar_image_id`, `deletingSince`. `user_id` gets the unique
  index it never had. No display name and no real name is stored.
- **`deviceclasses`**: `rolloutPaused`, `rolloutPercent` for the staged rollout on the admin fleet page.

### What becomes legacy or derived

| Existing | Status |
| --- | --- |
| `devicelogs.categories`, `title`, `data.*`, `deleted: true` on human entries | still written by every new writer in exactly today's shapes, so the Angular diary and grow report keep working; the new app reads `kind` and `values` |
| `cloudSettings.rtspStream` and the camera hints | write-through mirror of the device's `legacy_mirror` camera; removed in the release that retires the Angular app |
| `hardwareInfo.webcam_*` | unchanged transport from the firmware, consumed into the camera row |
| `recipe.activeSince` as "day in stage" | replaced by `grows.phases[]`; stays the plan's own step clock |
| `devices.name` | mirror of `spaces.name` for old clients |
| `SOCKET_ROLES` constant | the legacy five; validation uses what the device reports |

## Access

One function, `access(ctx, subject, need)`, in `server/src/common/auth/access.service.ts`. The existing
`DeviceAccessService` and `deviceAccessFilter` become wrappers over it, so today's guards keep their names, their
order and their refusals.

```
need:    own     claim/unclaim, cloud settings, delete a space/grow/camera, members, invites, shares, entitlement
         manage  configure, alarms, plan, test, maintenance, reboot, sockets, camera settings, others' entries
         log     write entries, upload photos, tick tasks, "in the tent", edit own entries
         view    every read

resolve(subject) -> { owner, demo?, public?, spaces[] }     device, space, grow, camera, entry or image
admin                                  -> allow (unchanged)
demo session                           -> allow view of demo objects, redacted (unchanged mechanism)
owner                                  -> allow
member of one of subject.spaces        -> view and log; manage with can_manage; never own
need != view                           -> deny
public grow                            -> allow view inside [startedAt, endedAt or now], privacy applied
valid share token covering the subject -> allow view; kind "view" clamps to [from, to]; pictures addressed by
                                          timestamp only when the link includes the cameras
otherwise                              -> deny (401 or 403 exactly as today)
```

A grow's spaces are all its links for `view`, and only its open links for `log` and `manage`. The window and
the privacy owner ride on the request, so every read route clamps its range and every serialiser strips harvest
weights, and plant counts when that setting is on, for anyone who is not the owner or a member. A member reading
alarms gets them with targets, headers and payloads stripped. Camera passwords never leave the server, which also
closes today's gap on the two admin device routes.

## The delta, implication by implication

Firmware impact is **none** unless stated. No route, topic or field is removed or renamed anywhere.

### 1 · Space

- **New routes:** `GET/POST /spaces`, `PATCH/DELETE /spaces/:id`, `PUT/DELETE /spaces/:id/devices/:device_id`,
  and the read models `GET /home` (one card per space: live values with age, setpoints, the grow half with its
  newest entries and their authors' handles, latest still, due strip, last alarm, followed grows) and
  `GET /spaces/:id/overview` (the tent overview including the 24 h climate verdict).
- **Changed:** `GET /device` additionally returns `space_id`; claiming a device writes `space_id: null`.
- **Migration:** `SpaceBackfill` gives every claimed device without `space_id` a space of its own (kind from the
  device type, name from the device), upserted by `origin.device_id`. Unplacing writes `null`, which the job
  skips, so the hourly run never re-places a device somebody took out of a space.
- **Left out:** a device in several spaces, nested rooms.

### 2 · Grow

- **New routes:** `GET/POST /grows`, `GET/PATCH/DELETE /grows/:id`, `POST /grows/:id/phases`,
  `POST /grows/:id/actions` (harvest, move, dry, cure, end; all backdatable), `POST /grows/:id/split`,
  `GET /grows/:id/weeks` (week cards: day and night averages, light hours, day thumbnails, the scheme week with
  feeds done, readings, entries), `GET /grows/:id/report` (the chapters; the same composer as the public page).
- **Behaviour:** creating a grow writes the first phase, the first link and the phase entry in its legacy shape.
  With a preset and a controller in the space it also applies the configuration through the existing
  `configureDevice`. Deleting a grow really deletes its entries, photos, follows and public link.
- **Migration:** `GrowBackfill` reconstructs cycles with the Angular grow report's own rule (new cycle on a
  stage-order rollback or a changed name), upserted by `origin {device_id, cycle_start}`, and stamps the entries
  with `grow_id`. A device with a running plan and no lifecycle entry gets a grow starting at `activeSince`, so
  it has a day counter on day one. An hourly adopter stamps lifecycle entries written later by old clients.
- **Left out:** a plant count for migrated grows; a stored week; server-side stage presets (client assets).

### 3 · Entry

- **New routes:** `GET /entries` (one scope of grow, space, device or plant; keyset pagination), `POST /entries`,
  `PUT/DELETE /entries/:id`, `POST /images` (a photo against a grow or space, stored without `device_id`).
- **Changed (additive):** `POST/PUT /device/logs/...` accept the new fields and stamp the author;
  `GET /device/logs/:id` returns them. Device log messages over MQTT get `kind: system`, `source: device` and
  the space.
- **Behaviour:** every new writer also writes `categories`, `title`, `message`, `data` and `deleted: true`
  exactly as the Angular diary does. `undoUntil = now + 5 s` is the server-side Undo window; deletes stay hard.
  A `visit` entry also starts the existing maintenance mode on the space's controllers.
- **Migration:** none needed for correctness. A normaliser maps `categories` to `kind`; `EntryKindBackfill`
  writes `kind`, `source` and `space_id` in batches so the new indexes are useful.
- **Left out:** comments, reactions, edit history, a plants collection.

### 4 · Task

- **Derived, not stored.** `GET /tasks?scope=mine|all` computes tasks from reminders on grows and spaces, the
  stored scheme grid, the running plan's step end and plan suggestions. Task ids are deterministic
  (`reminder:<id>:<date>`, `scheme:<grow>:w<n>:<k>`, `plan:<device>:<step>:<activeSince>`), and "done" is an entry
  carrying that `task_id`. `POST /tasks/:task_id/done` writes the entry; for a plan task it also confirms the step.
- **Migration:** none. The confirmation mail and entry of a waiting plan step keep going out as today.
- **Left out:** assigning a derived task to somebody other than the reminder's assignee, snooze.

### 5 · Membership

- **New routes:** `GET/POST /spaces/:id/members`, `PATCH/DELETE /spaces/:id/members/:user_id`,
  `POST /spaces/:id/invites`, `DELETE /invites/:code`, `GET /join/:code` (public, rate-limited preview of what the
  invitee will see), `POST /join/:code`, and `GET /devices` (the Devices tab for owners and members: controllers,
  cameras and sockets with their state).
- **Changed:** every route behind `DeviceOwnerGuard` or `DeviceAccessGuard` consults `access()` after the owner
  check. Paths, payloads and refusals stay. `GET /device` stays owner-scoped, so the Angular app and the Garmin
  widget see exactly today's list.
- **Behaviour:** adding by handle works only for a handle that already shares a space with the caller; there is
  no directory and no lookup by e-mail.
- **Migration:** none; owners are the devices' owners at backfill. `devices.owner_id` keeps every meaning it has.
- **Left out:** a viewer role (share links are the read-only path), per-person reports.

### 6 · Camera

- **New routes:** `GET/POST /cameras`, `PATCH/DELETE /cameras/:id`, `POST /cameras/:id/test`,
  `GET /cameras/:id/image` (the picture route keyed by camera, needed because a standalone camera has no device),
  `GET /cameras/:id/frames` (the scrubber), `POST/GET /cameras/:id/timelapses` (the composer: range, aspect,
  overlays, lights-off frames, quality; rendered by the existing hourly builder, which drains a queue first),
  `PUT /cameras/:id/premium` (admin; the only writer of an entitlement, nothing renews on its own).
- **Changed:** `GET /image/:device_id` resolves the device's mirrored camera and accepts `camera_id=`. The
  poller, timelapse builder, thinning and retention iterate cameras instead of devices and stamp `camera_id`.
- **MQTT:** unchanged. A controller still pairs exactly one Terp Cam. "Several cameras per tent" is one
  controller camera plus RTSP cameras plus standalone Terp Cams, which needs no firmware change.
- **Migration:** `CameraBackfill` creates a row for every device with a stream configured, `legacy_mirror:
  true`, and **gives every existing camera, Terp Cam and RTSP alike, a migration year of entitlement**, so nobody
  loses a still on deploy day. Stills are stamped with `camera_id` hourly in batches; readers meanwhile match
  `camera_id` or the unstamped device rows.
- **Left out:** a second Terp Cam on one controller (firmware), live video, a render queue beyond the hourly pass.

### 7 · Measurements and schemes

- **Routes:** definitions and the scheme are fields of `PATCH /grows/:id`; own schemes of `PATCH /me`;
  `GET /grows/:id/series?keys=` serves measurement series for the charts; `GET /grows/:id/export.csv` exports
  readings, water and feed columns and the controllers' series including output states.
- **Changed:** `GET /data/series` accepts `<measure>_day` and `<measure>_night` for any field, a small
  generalisation of today's VPD-only branch, used for the week cards.
- **Assets:** schemes ship as JSON in the React app and are regenerated by a skill from the manufacturers'
  charts. The server never reads them.
- **Left out:** server-side dose maths, scheme versioning on the server, a schemes collection.

### 8 · Share, public page, link card

- **Changed:** `POST /share` accepts `kind`, `grow_id`, `space_id`, `from`, `to`, `cams`; today's body is
  accepted byte for byte and stored as `legacy`. `GET /share/resolve/:id` answers as today for legacy rows and
  adds the new fields otherwise.
- **New routes:** `GET /public/grows/:slug` (the story page, cached 5 min), `GET /public/grows/:slug/image/:id`
  (token-less pictures limited to the grow's own closure), `GET /public/grows/:slug/card.png` (the unfurl image),
  `GET /public/users/:handle` (only when the profile is public), and `GET /g/:slug`, `GET /@:handle` (a small HTML
  shell with Open Graph tags, because the SPA's index is static).
- **Enforcement:** the link's time range moves from a trusted query string to a clamp on every read route.
- **Migration:** none; every existing link resolves exactly as today and keeps opening in the Angular app.
- **Left out:** link-level privacy overrides, password-protected links, any directory.

### 9 · Follow

- **New routes:** `PUT/DELETE /follows/:grow_id`, `GET /follows`, `GET/PATCH /me`, `GET /me/sessions`,
  `DELETE /me/sessions/:id`. Following grants nothing a visitor of the public page does not have.
- **Left out:** follower lists (only a count), notifications about followed grows, following a user.

### 10 · One lifecycle writer

- `GrowService.setPhase` is the only writer of a phase. It appends the phase, writes the entry in its legacy
  shape on the grow and on the linked controller, and re-reads stage-bound alarm thresholds.
- **Callers:** the grow routes, the recipe engine (`source: plan`) and the new `POST /spaces/:id/preset`, which
  applies a stage preset to the space's controllers. With an open grow it sets the phase (`source: preset`);
  without one it answers `needsGrowDecision`, and the client offers "start a grow here", "move a grow here" or
  "only climate".
- A tent that regulates with no grow behaves as today: the engine falls back to the existing two-argument
  writer and no grow is invented.

### 11 · Sockets (the only firmware change)

See "Firmware delta" below. On the server, `POST /device/auxcommand` gets the schema it lacks and one new action,
`socket_override`; `socket_set` gains an optional `timer`. Roles and commands are validated against what the
device reports, not against a constant.

### 12 · RTSP through the controller, standalone Terp Cams

- **RTSP** is a camera row with `device_id` and `tunnel: true`, pulled through the existing TCP tunnel at still
  cadence. Creating one is **never refused**; without entitlement it polls and falls under the free limits.
- **Standalone:** the phone joins the camera's setup network and runs the pairing sequence the controller
  firmware already runs, then posts the camera's id. The server reaches it over the existing direct path, reading
  identity from the camera row instead of from a device. Without rendezvous hosts configured, which is the
  self-hosted default, the route answers 501 and the app's tab says so.
- **Left out:** video through the tunnel, a real `cam` firmware.

## Cross-cutting behaviour

- **Day counter, phase, "auto".** Computed once in the grow serialiser from `phases[]`: `day = floor((now -
  phases[0].since) / 1 d) + 1`; a plant's phase is the latest phase whose scope includes it; the headline is the
  largest plant group and the groups are listed when they differ; `auto` is `source` in `{preset, plan}`. Future
  bar segments come from a running plan's steps, otherwise from the client's default stage sequence.
- **The plan and the 20 s engine** stay where they are, on the device. Additions: the lifecycle writers call
  `setPhase`; `POST /device/recipe/:device_id/step { confirm | skip | extend | pause | resume }` loads the plan,
  mutates it and calls the unchanged `save()`, so every side effect stays identical. Pause stores the elapsed
  time with `activeSince: 0`. **Running-plan rule:** the engine re-applies its step hourly, so a preset applied
  beside a running plan would be undone. When the plan's next step carries the requested stage the action
  becomes a skip; otherwise the plan pauses and the preset is applied.
- **Camera mirror.** The reconcile that today writes `rtspStream` when a device reports a camera upserts the
  camera row and keeps the mirror. `POST /device/cloudsettings` from the Angular app upserts the same row. The
  two paths converge in one service.
- **Entitlement gate** (`PREMIUM_ENFORCED`; unset gates nothing, which is what a self-hosted install gets).
  Enforced in the image pipeline only: free cameras are **served** at a reduced width while full stills stay
  stored, so extending restores history; free retention is shorter; HD and whole-grow renders need entitlement
  and SD renders carry a watermark. The reduced width and the two free retention windows are
  **configuration, not constants**, so this repository carries the mechanism and the hosted install its numbers.
- **Age of a value.** `GET /live?space_id=|device_id=` answers every field with `{ value, at, state }` from one
  Flux `last()` per device, with `state` from one shared constant `VALUE_AGE = { live: 120 s, stale:
  ONLINE_TIMEOUT }` and the server's clock. `GET /data/latest/...` keeps its shape, its window and its 201 for
  the Garmin widget and additionally returns `at` and `state`.
- **Demo.** `devices.demoDevice` stays the master switch and propagates to the device's space, grows and
  cameras. A `demo-seed` subcommand of `simulate-device.sh` creates the demo grow and its public page.

## Screens outside the twelve, served by the same delta

- **Alarms and the alerts inbox.** The alarm fields above. A health loop on the existing background tick
  evaluates `offline` from `lastseen` through the unchanged alarm state machine. Stage-bound thresholds are
  re-read from one table in shared types on every phase change. `POST /device/alarms/:device_id/:alarm_id/silence`.
  `GET /alerts` pairs triggered and resolved entries by the `alarmId` the engine now writes into them.
- **Notifications.** One send decision per person: mute, quiet hours in the user's time zone (critical still
  comes through), otherwise the channels the grid names. E-mail and webhook as today; **Web Push** with
  subscriptions on the user and a VAPID key pair in configuration; **Telegram** as one bot per install with a
  link route and a public webhook guarded by a secret in its path, where a reply to a message the bot sent
  becomes a note. Producers: an hourly task-due notifier, a weekly link to the week's timelapse, members'
  entries. Every channel is off until configured and the screen says so.
- **Privacy.** `GET /me/export` (a zip of JSON, one CSV per grow and the photos), `DELETE /me` (ordered,
  re-runnable, resumed at boot; devices are unclaimed and stay claimable), and climate retention: days about to
  leave the window are summarised into a `status_daily` measurement in the same bucket, then the raw points are
  deleted, and `GET /data/series` reads the summaries for the older part of a range.
- **Fleet admin.** `GET /admin/fleet`, `GET /admin/stats`, `GET /admin/logs`, plus pausing and staging a
  rollout per device class. Admin only.

## Firmware delta

Four files, all for item 11: `firmware/src/wifi.cpp`, `firmware/src/wifi.h`,
`firmware/src_hwtype/controller/controller.cpp`, `firmware/src_hwtype/fridge/fridge.cpp`, mirrored in
`scripts/simulate-device.mjs`.

- **Roles** gain `humidifier · exhaust · circulation · fan · pump · custom_timer · manual`; the empty role is
  "unassigned" and never driven.
- **New command** `{ action: "socket_override", slot | output: "light", state: on | off | auto, seconds }`. The
  override is a per-row value in RAM with an expiry, consulted before the timer and the role target. It dies
  with a reboot, which is the failsafe.
- **`socket_set` gains `timer { onS, everyS }`** for `pump` and `custom_timer`, stored in the socket's NVS row.
- **Three boot keys** through the unchanged `hardware-info:` sub-protocol: `socket_roles=<csv>`, `caps=<csv>`
  (`socket_override`, `socket_timer`, `light_override`) and `socket_pulse=<role>:<seconds>,...` (the failsafe
  each role is programmed with). A device that reports none of them is sent nothing new and its switches render
  disabled with "needs the next controller firmware".
- **The socket report** grows from `role|id|ip` to `role|id|ip|state|override-or-timer` and is re-sent when a
  row's state changes, at most once per 30 s. Today's parser reads the first three columns.
- **Proposed control laws** (open question 1): humidifier mirrors the dehumidifier hysteresis below the target,
  exhaust follows the cooling condition the temperature mode already computes, circulation and fan run whenever
  the controller is not off, pump and custom timer follow their own timer, manual is off unless overridden.

## Migration and rollback

One `RedesignBackfillService` with jobs on the existing `BackgroundWork`, staggered from 20 s after boot, which
is before the camera poller's first pass and the plan engine's first tick, then hourly:

1. the images index drop (once, inside try/catch),
2. `SpaceBackfill`,
3. `CameraBackfill` and the hourly still stamping,
4. `GrowBackfill` and its adopter,
5. `EntryKindBackfill`,
6. demo propagation.

Every job is a "field missing" or "origin absent" query, so a kill half-way is resumed by the next run, and a
rollback followed by a return is healed without anyone doing anything.

**The index swap is the one step outside the house style.** Two cameras in one tent, or two standalone cameras
(a missing `device_id` indexes as `null`), collide every hour on the old unique key, because timelapse rows are
stored and looked up by their aligned period start. The schema declares the two new indexes and no longer the
old one; mongoose builds the new ones at boot and the backfill service then drops the old one by name.

**Rolling back one version:** new collections and fields are ignored; devices, entries, images and shares keep
working; paused plans read as stopped; alarms fall back to today's delivery; cameras that are not a device's
mirrored camera pause; members lose access until the new server returns. The previous build tries to recreate
the old unique index, which fails once two cameras have produced the same timelapse window. Mongoose swallows
that failure, stills keep flowing either way, and the new server drops the index again on its next boot. The
new server registers an `index` listener on every model so that an index problem is at least logged.

**Old clients during the transition:** the Angular app, the Garmin widget and the simulator see today's routes
and shapes. `GET /device` gains one key. A member who logs into the Angular app sees no devices, which is
accepted: the Angular app never had members.

## Size of the change

| What | Count |
| --- | --- |
| New collections | 6: `spaces`, `grows`, `cameras`, `memberships`, `invites`, `follows` |
| Changed collections | 6, additive: `devices`, `devicelogs`, `images`, `shares`, `users`, `deviceclasses`; three relaxed `required`s, one index swap, seven new indexes |
| New routes | 73: spaces 7 · read models 5 · grows 12 · entries 5 · tasks 2 · members and invites 8 · me 9 · Telegram 1 · admin 3 · alarms 1 · plan 1 · cameras 10 · public 6 · follows 3 |
| Changed routes | 16, all additive, plus the guard semantics behind the device guards |
| Removed or renamed | 0 |
| MQTT | 1 new command, 1 extended command, 3 new `hardware-info` keys, 1 extended report; all gated on reported capabilities |
| Firmware files | 4, plus the simulator |
| Configuration and packages | optional variables for entitlement, Web Push and Telegram, all off when unset; packages `archiver` and `web-push` |
| Server files | about 50 of the 116 existing files changed, about 54 new |

This is not a small change. About 60 of the 73 routes serve the twelve items; the rest is what the decided
screens draw beyond them (the alerts inbox, notification channels, sessions, export and deletion, the fleet
table).
It is small in the sense that matters for the systems already running: nothing is removed, nothing is renamed,
and the firmware changes in one place.

## Order of delivery

The delta lands with the app slice that needs it, in the order of the decision record, so no slice waits for
the whole backend and the backend never runs ahead of a screen that uses it.

| App slice | Backend that lands with it |
| --- | --- |
| 1 Shell and home | `spaces` and its backfill, `access()`, `GET /home`, `GET /live` with `VALUE_AGE`, `GET/PATCH /me` with `handle` |
| 2 Grow and tent pages | `grows` and its backfill, grow CRUD, `/weeks`, `/overview` with the 24 h verdict, `_day`/`_night` series |
| 3 Logging | entry fields, `/entries`, `POST /images`, the Undo window, `EntryKindBackfill` |
| 4 Timeline | `cameras` and its backfill, the index swap, camera read routes, `/frames`, phase target bands |
| 5 Devices | `GET /devices`, camera create and settings, the timelapse composer, sockets on the server and in the firmware |
| 6 Public diary | `visibility` and `slug`, the public routes, the card, the Open Graph shell, share kinds with the range clamp |
| 7 Lifecycle | phases, actions, split, `POST /spaces/:id/preset`, the engine calling `setPhase` |
| 9 Controller | `POST /device/recipe/:id/step`, the pause fields, the running-plan rule |
| 10 Alarms, tasks, notifications | alarm fields, health loop, threshold table, silence, `/alerts`, `/tasks`, the send decision, Web Push, Telegram, the notifiers |
| 11 Onboarding | claim writes `space_id: null`, the standalone camera path, `demo-seed` |
| 12 Measurements and charts | measurement definitions, `/series`, `export.csv`, own schemes |
| 13 Sharing | `memberships`, `invites`, the join routes, the widened guards, stripped alarms for members |
| 14 Account, entitlement, admin | the entitlement gate, sessions, export, deletion, climate retention, the fleet routes, staged rollout |

Slice 8 (visual direction) needs no backend.

## Risks

1. **The index swap** takes minutes on a large `images` collection and belongs in a maintenance window. Its
   rollback behaviour is described above and is noisy rather than harmful.
2. **Two mirrors during the transition**: `cloudSettings` and the mirrored camera, legacy entry fields and
   `kind`/`values`. Each is written in one service and healed hourly, and each is a place for drift until the
   Angular app is retired.
3. **Caches inside `recipe` and `alarms[]` are lost** when an old server or old client rewrites the
   subdocument. A plan paused in the new app and then saved once in the Angular app has to be resumed by hand.
   Visible and re-doable, never corrupting.
4. **The grow backfill inherits the grow report's heuristics.** Two consecutive grows with the same name and no
   stage rollback merge; migrated grows have no plant count.
5. **Membership widens every device-guarded route for managers.** The `need` table is the checklist, and the
   contract test has to assert the level per route before the guards are switched.
6. **Read models cost queries.** The home of a club is about six Mongo queries plus one Flux query per device;
   the week cards and the public page run one aggregate per week and controller on the first uncached hit.
7. **Cascading deletes are new to this server** and need their own specs.
8. **Control laws for the new roles are decided here, not by a screen.** They ship behind `socket_roles`, so a
   firmware that omits a role never offers it.
9. **The standalone Terp Cam flow is unproven end to end.** The model holds it either way.
10. **Retention deletes pictures** where today everything is kept for three years. The migration year means
    nobody loses anything on deploy day.
11. **Two new outward-facing surfaces**, Web Push and the Telegram webhook, both off until configured.

## Alternatives considered

- **Smallest diff** (three collections, members and invites embedded in spaces, a summary cache on the grow,
  phases as entries only). Not taken: embedded members mean a multikey lookup per request and a second migration
  once a club grows; a cache recomputed on every entry write is wrong after one missed call site; phases without
  plant scope cannot show a split harvest. Taken from it: the index swap, "unset gates nothing", the
  `_day`/`_night` series, rooms as spaces of kind `room`, the `offline` sensor type.
- **Derive at read time** (implicit `dev:<device_id>` spaces and cameras, everything a read model). Not taken:
  an implicit id convention has to be unioned on every read and materialised on every write; its pause flag
  beside a live `activeSince` lets a rolled-back engine resume the plan over manual targets; `device_id =
  camera_id` on standalone stills would be deleted by a rolled-back cleanup. Taken from it: the read models, the
  verdict specification, per-plant phase scope, serve-time SD, the served `state`, the capability key.
- **No firmware change** (a cloud-side `sockets` collection driving Tasmota through the tunnel). Not taken: the
  tunnel reads only while the display is idle and is shared with the camera pull, so a timed pump would miss its
  slot, and the decided switches on controller-driven sockets would not work at all. Taken from it: the preset
  route with its three decisions, the grow from a running plan, the health loop, the rule that a control that
  cannot work is shown disabled.
- **Clean domain** (a `schemes` collection, `late_flowering` and `ended` as stages, a version-compare firmware
  gate). Not taken: new stage values would reach old readers that cannot order them; the version gate cannot be
  written. Taken from it: plant scope on phases and links, split by count, the token-less picture closure for
  public pages, invite codes from the claim-code alphabet.
- **Migration safety** was the base and is kept almost whole. Changed against it: the images index is swapped,
  an RTSP camera is never refused, members get a Devices route, the camera record becomes the single truth with
  one poller loop, and the alarm and notification screens get a mechanism rather than tags.

## Open questions

Each with the assumption the design stands on until it is answered.

1. **Control laws for the new socket roles.** Assumed as listed under "Firmware delta".
2. **Stills when an entitlement lapses.** Assumed the free window applies to everything; the gentler
   alternative keeps what was captured while entitled and applies the window only to later stills.
3. **The migration year for every existing camera, RTSP included.** Assumed yes.
4. **When an included year starts for a camera sold before launch.** Assumed the day its record is created.
5. **The reduced width served to free cameras.** Assumed a configuration value; nothing here fixes the number.
6. **The light row on the Devices tab.** Assumed its switch overrides the controller's own light output through
   the same command (`output: "light"`); if it is meant as a socket with role `light` only, that variant goes.
7. **Invite codes.** Assumed one 8-character code for link, typed code and QR, with a rate-limited preview.
8. **Web Push** is in the delta because the notification screen draws it as a working channel. Assumed
   acceptable that an install without keys shows the channel as unavailable.
9. **Self-hosted installs.** Assumed "no Premium" means nothing is gated.
10. **"Late flower" as a preset label, not a stage.** Assumed.
11. **Migrated grows that merge** because they share a name. Assumed acceptable; it is what the Angular report
    shows today.
12. **`GET /device` for members.** Assumed it stays owner-only and the new app uses `GET /devices`.
13. **The weekly recap.** Assumed a link to the week's existing timelapse, not a composed film per grow.
14. **Deleting an account that owns a space with members.** Assumed the members are removed and the space
    deleted; the alternative refuses until the members are removed by hand.
15. **Does a Terp Cam's entitlement cover an RTSP camera in the same tent?** Assumed no, per camera record.
16. **A human phase action on a tent with a running plan.** Assumed skip when the plan's next step carries the
    stage, pause otherwise, and the sheet says which before the tap.
17. **"Mute all" mutes critical alarms too**, for the person who tapped it only. Assumed yes.
18. **Telegram as one bot per install**, and "log by replying" meaning a reply to a message the bot sent.
19. **How many feeds a week has.** Assumed from the feed reminder's rhythm, else the water reminder's, else
    three.
20. **A stale alert out of the box.** Assumed opt-in beside the always-on offline alarm.
21. **Free-tier limits as configuration.** Assumed they stay out of this repository until they are public; if
    they may be public, they become constants in shared types and the app reads them from there.
22. **Staging.** Assumed each part of the delta ships with its slice as listed; Web Push, Telegram, the recap,
    export, climate retention and the fleet routes are the parts that could move later without blocking a
    screen from being drawn honestly.
