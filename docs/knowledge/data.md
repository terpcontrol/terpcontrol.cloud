---
summary: Where the server's data lives and the rules for code that touches it - MongoDB and its pitfalls, the GridFS picture bucket, InfluxDB, retention and cleanup, exports
updated: 2026-10-08
source: Chris (decisions in sessions and PR reviews, 2026-08-25..10-08); agent sessions on the app rewrite, 2026-09-10..10-04; PRs #80, #87, #90, #91; codebase cleanup (2026-10-08); checked against the code on 2026-10-08
paths:
  - server/src/database/**
  - server/src/modules/data/**
  - server/src/modules/retention/**
  - server/src/modules/cleanup/**
  - server/src/modules/v1/grow/export*.ts
  - server/src/modules/v1/camera/timelapse.service.ts
  - server/src/modules/v1/camera/media*.ts
---
# Data: where it lives and how it changes

The model was decided in [ADR 0001](../adr/0001-app-rewrite-data-model.md); what a device writes to InfluxDB is in
[device-protocol.md §5](../device-protocol.md#5-readings); API, configuration and media serving are in
[server.md](server.md). Upgrades, migrations, old data shapes and backups are in
[data-operations.md](data-operations.md). This document holds what a change to code that touches the data needs.

## Where it lives

- **MongoDB** (database `MONGODB_DATABASE`, volume `mongodata`): one collection per schema in
  `server/src/database/schemas/v1/` - 29 since `targetChanges`, the record of what each device aimed at, joined the
  ADR's 28 (2026-10-01); where the ADR's tables lag, the schemas are the truth. Beside them `migrations`,
  `migrationLock`, the `legacy_*` collections of a migrated install, and the GridFS bucket `imagedata.files`/`.chunks`
  with every picture, film and export. Firmware binaries are the one payload inside documents (`firmwareBinaries.data`).
- **InfluxDB 2** (volume `influxdata`, bucket `INFLUXDB_BUCKET`): measurement `status` (raw samples) and `status_daily`
  (what climate retention keeps of older days). No setpoints.
- **Volumes** are named after the compose project (`DOCKER_COMPOSE_NAME`, `.env.sample`), or pre-created ones are named
  with `DOCKER_MONGODATA_EXTERNAL`/`_VOLUME` and `DOCKER_INFLUXDATA_EXTERNAL`/`_VOLUME` (the Raspberry Pi guide does).
  Any named volume outlives a recreate; `external` only keeps `./down.sh --volumes` off it, so emptying such a
  database takes a `docker volume rm`. A directory renamed without `DOCKER_COMPOSE_NAME` starts on new, empty volumes.
- **No transactions.** MongoDB runs without a replica set (compose and the tests' `MongoMemoryServer`); nothing calls
  `startSession`. Work across collections - migrations, account deletion - is idempotent and resumable, with a
  single-document write as its commit point (e.g. `users.deletionStartedAt`).

## MongoDB

**Every boot** runs the migrations before `listen`, then builds the indexes of `users` and `devices` itself (their
models say `autoIndex: false`, as those names hold the old shapes until the rename); every other model's indexes are
built by mongoose as it compiles. What boot seeds - device classes, the admin account - is in [server.md](server.md).

Pitfalls, each met at least once:

- **Undeclared fields vanish:** strict mode drops on save what the schema does not declare, silently (a recipe step's
  name, `ppfdLuxFactor`). A persisted field goes into the schema as well as into the `shared-types` contract.
- **Defaults do not backfill:** a lean read answers what the document holds, so a new field is missing on older
  documents until a migration step writes it (`015-warnings-routing`, `016-measurement-band`) - or a loop fills it
  wherever it is missing, which holds however a row arrives (`cameras.staleWarning`, `alarm-health.service.ts`).
- **Empty objects vanish** without `minimize: false`: a webhook channel stored without its empty `headers` map took
  `/me/notifications` down for good (2026-09-23). `devices`, `plans`, `planTemplates` and the webhook subschemas set it.
- **`required: true` on a String refuses `''`** (`plants.strain`; the app sends "Unnamed" for a blank strain).
- **`timestamps: true`** (`grows`) bumps `updatedAt` on every update, so `modifiedCount` is 1 even when a `$pull`
  matched nothing - check the document. `updatedAt` is the write time, not when the diary moved.
- **Index builds fail silently:** mongoose swallows a failed background build, so a unique index added over duplicates
  never existed - production held duplicate addresses under one. `IndexBuildLog` logs `Index build failed on ...`;
  checks that matter count rows (the migration preflight does).
- **Mongoose never changes a built index:** new options under existing data need a step that drops the old index
  (`014-one-line-per-task`); the schema builds the new one at the next boot, and cannot while duplicates exist.
- **Two `$or` in one object overwrite each other.** `afterCursor()` (`common/v1/pages.ts`) and the visibility filters
  both answer `$or`; spread into one query, page two of a list held what its filter excluded - other people's rows
  three times, firmware builds never offered to the device once. Combine with `{ $and: [visibility, filter, cursor] }`
  (Chris, 2026-09-18), as `findPage` does ([server.md](server.md#the-v1-contract)).
- **`$in` with `null` matches documents without the field**, so references are `null`, never absent, and sweeps pass
  only real ids (`named()` in `cleanup.service.ts`).
- **No update path from input:** a device's `hardware-info` key passes `^[a-zA-Z0-9_-]{1,64}$` (value at most 512
  bytes) before it becomes `state.hardware.<key>` (`hardware-report.service.ts`).
- **`select: false`** keeps `users.passwordHash`, `passwordResets.tokenHash`, `devices.mqtt` (the broker
  credentials), `devices.cameraSecret`, `cameras.secret` and the firmware payload (`firmwareBinaries.data`) out of
  every read that does not ask for them. `users.activationCode` is read like any field and kept out of answers by the
  serialiser; webhook headers: [server.md](server.md#security-decisions).
- **MongoDB 4.4 has to keep working** (`.env.sample` offers it for CPUs without AVX): check new aggregation operators
  against it. `011-entries` asks `buildInfo` and does without `$topN` (5.2+); a spec compares both paths on a modern
  server, neither has run on a real 4.4 (2026-10-04).

## GridFS: pictures, films and exports

- **Why:** a BSON document holds 16 MiB, and the driver overruns its serialisation buffer before that with a bare
  `RangeError: offset is out of bounds`; a day's full-resolution timelapse (~60 MiB) crash-looped the server that way.
  Chris decided that picture and video quality must not suffer, so the bytes went to GridFS rather than being capped
  (2026-09-10). Never store a payload inline.
- **Shape:** bucket `imagedata`; a file's `_id` is the media row's `id` - a string, not an ObjectId - which was the old
  `images.image_id`, so the migration rewrote rows, never bytes. One bucket on purpose: a second would have meant
  copying nearly the whole disk. A `media` row (`kind` still, timelapse, photo, avatar, export) holds query fields and
  `bytes`.
- **Writes:** stills and photos go bytes first, row second, so a crash in between leaves an orphaned file for the
  cleanup; composed films and exports are queued as a row and filled later. `ImageStore` streams - nothing holds a
  whole film in memory.
- **Deleting:** mongoose's `deleteOne`/`deleteMany`/`findOneAndDelete` on `media` purge the files in a schema hook; a
  raw `db.media.deleteMany()` does not. By hand: delete `imagedata.chunks` by `files_id`, `imagedata.files` by `_id`,
  then the rows - or leave the orphans to the cleanup.
- **Volume:** a camera stores a still every 30 s, thinned with age and deleted after three years (tiers in
  [terp-cam.md](terp-cam.md), Stills): up to ~48,000 stills, some 6 GB a camera at ~130 KB per 2304x1296 still
  (2026-09). Films are made per day, week and month; the open period's film is replaced as it grows, closed ones are
  kept. Every Mongo backup carries all of it.
- **Photos** are stored as a rotated JPEG without metadata; those from before the rewrite keep their EXIF, GPS
  included, in the bucket ([server.md](server.md) has how they are served).

## InfluxDB

- **Computed, not stored:** `vpd` and `ppfd` are worked out on every read (`computedValue`, `modules/data/flux.ts`)
  with the device's `settings` (`vpdLeafOffsetDay`/`Night`, 0 meaning the air's VPD; `ppfdLuxFactor`, default 0.015),
  so changing a factor changes the history. The VPD curve is `shared-types/src/v1/vpd.ts`, the one the targets screen
  uses too. Targets live in Mongo (`targetChanges`, phase snapshots).
- **Which leaf offset a VPD takes** is the half the device was in: off the lamp for a controller, a fridge and a LIGHT
  (a series window by the lamp's majority, from its switchings); for an AIR fan, which has none, the `day` it reports
  off its light sensor (live its newest, a series window by the majority of its `day` switchings, read in the lamp's
  scan; only a fan writes `day`, so the others pay nothing for it); for a smart plug, which has neither, its own
  schedule (`usedaynight`), else the newest measured still of a camera in its space (grey is night,
  `media.monochrome`), else the night (Chris, 2026-10-08; [ADR 0006](../adr/0006-day-and-night-by-the-device-clock.md)).
  A plug window is read at its middle. Without a schedule a plug's read costs two Mongo reads more
  (`StillDaylightService`: the space's cameras, one `$group` of their stills by half steps), none per point.
- **Written, not served:** the controller diagnostics `avg`, `p`, `i`, `d`, `rpm`, `day`, `sensor_type`.
- **Reads** (`DataService`): a series is `aggregateWindow(mean)` over `status` and `status_daily`, empty windows kept -
  at most 1,000 windows unasked, an asked step honoured down to 5 s up to 5,000 windows, at most 50,000 points.
  `/live` is one `last()` over 30 days. `history()` adds each output's switchings at a 5-minute grain, because a mean
  turns a lamp into a duty cycle.
- **Building Flux:** queries are strings, so only values passing `SAFE_NAME`/`FIELD_NAME` and instants from a `Date` are
  interpolated, never request input (Chris, 2026-08-25; [server.md](server.md#security-decisions)).
- **One device per query, by tag equality.** `r["device_id"] == "<id>"` is pushed down to the index; `contains(value:
  r["device_id"], set: [...])` is not, so a `last()` behind it scans every series in the range - ranged over months, the
  alarm health loop's read never returned and took InfluxDB down (2026-09-24; [server-engines.md](server-engines.md)).
  An `or` chain over many ids fails with "Program is nested too deep". The home sparklines (`trendQuery`) still use
  `contains()`, over 24 hours.
- **The client's 10 s timeout is a socket timeout** and never fires on a busy connection: race reads against a budget
  of your own, as `newestSamplesOf` does.
- **Deletes** go through `POST /api/v2/delete` (the JS client has none) with `rawSamplePredicate` (spares
  `status_daily`) or `everySamplePredicate`.

## Retention and cleanup

| Job | When | What goes |
| --- | --- | --- |
| Climate retention (`modules/retention/`) | 03:00 server time; first pass 10 min after boot | Days older than the window (cut at UTC midnight) become one mean per field and day in `status_daily`, then their raw points go. Window: the space's `retention.climateDays`, else the owner's, else `RETENTION_CLIMATE_DAYS` (compose default 0: nothing is swept). 500 devices a pass, rotated by `devices.climateSweptAt`, 90 days of backlog each; last pass in `GET /admin/stats` (memory only). |
| Still thinning (daily), picture sweep (hourly) | per camera, removed ones included | See GridFS. With `PREMIUM_ENFORCED` and `PREMIUM_FREE_RETENTION`, a camera without entitlement keeps stills `PREMIUM_FREE_STILL_DAYS` and films `PREMIUM_FREE_TIMELAPSE_DAYS`; off by default. |
| Cleanup (`modules/cleanup/`) | daily; first run 5 min after boot | After 7 days' grace: entries whose grow, space and device are all gone; media whose camera, grow and space are all gone and that no entry, grow cover or film, or avatar names (every export, therefore); GridFS files without a media row. Successful `message-cam-capture` lines at any age. |
| TTL indexes | MongoDB | `sessions`, `passwordResets`, `notificationLog` at `expiresAt`. |
| Account deletion | in the request; resumed 5 s after boot and hourly | What the account owns. Device rows stay claimable and keep their readings; its lines in other people's records stay, authorless. |

- While `legacy_images` stands, thinning and the cleanup spare every picture it names (`migrations/way-back.ts`); the
  hourly picture sweep does not. Dropping `legacy_images` hands those pictures to both.
- A summarised day keeps only means: switchings, output levels and CO2 valve counts read raw samples only.
- A photo uploaded and never attached to an entry stays while its grow or space exists - the cleanup takes only what
  nothing reaches - although the upload route's comment says the daily sweep removes it.

## Exports

`GET /v1/grows/{id}/export` (needs `own`) and `GET /v1/me/export` answer a job that is a `media` row of kind `export`
(`uploadedBy`, `exportJob`): 202 until `ready`, then 200; one finished within the hour is answered again. Its bytes
need a user session (the media token is refused); the cleanup removes it a week later. `export.service.ts` builds one
at a time and re-queues a build left in `rendering`.

- **Grow zip:** `grow.csv`, `plants.csv`, `diary.csv`, `measurements.csv`, `climate.csv`, `photos/` (entry pictures,
  cover, film). **Account zip:** settings; CSVs of spaces, devices, cameras, alarms, alerts, tasks, plans; diary lines
  without a grow and their photos; `films/` (every finished film of every camera); `climate/<device>.csv`;
  `grows/<slug>/`; `stills.csv` (a tally - stills are never exported); `README.txt`.
- **Climate is per-minute means** (`CLIMATE_STEP_SECONDS`), stamped at the minute's end and read in 12-hour chunks;
  relay outputs come out as duty fractions (0.67). Raw would be twelve times larger. `README.txt` says so, since a CSV
  has nowhere to.
- **Written by hand** (`export-zip.ts`: streamed entries, data descriptors, Zip64; no zip library in `server/`). An
  alarm's custom webhook is exported as `custom · webhook` only.
- **No placement history:** a device row knows only where it stands now, so a grow's climate (export, series, week
  cards) comes from the devices standing today in the spaces the grow stood in (`spacesDuring`,
  `modules/v1/grow/grow-places.ts`); one moved out is not read for the days it was there.
