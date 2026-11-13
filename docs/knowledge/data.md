---
summary: Where the server's data lives and the rules for code that touches it - MongoDB and its pitfalls, the GridFS picture bucket, InfluxDB, retention and cleanup, exports
updated: 2026-11-13
source: Chris (decisions in sessions and PR reviews, 2026-08-25..10-08); placements and unique names: the redesign session of 2026-11-12, awaiting Chris's confirmation of the ADR 0001 amendment; agent sessions on the app rewrite, 2026-09-10..10-04; PRs #80, #87, #90, #91; codebase cleanup (2026-10-08); checked against the code on 2026-10-08; the extremes and the switching grain, with what the Timeline's read costs, and the deficit of samples after the critic's walk (the redesign session of 2026-11-12); the alerts index: the redesign session's clearing-up round of 2026-11-13
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

- **Where a device stood** is `devices.placements[]` (`spaceId`, `startedAt`, `endedAt`; at most one open), and
  `devices.spaceId` is the open one's place. One writer sets both in one update (`DevicesService.place`, with the
  arithmetic in `movedTo`): never `$set` a device's `spaceId` anywhere else. A read about now asks `spaceId`, a read
  about a stretch of time asks `stoodIn`/`stayOf`, which answer each device with the part of the stretch it stood
  there - and a history read is asked for that part only, so no hour of a place is ever read from a device that
  stood elsewhere. A device's first placement is read back past its `startedAt` (`beginsAt`): what it measured
  before it was first put anywhere counts for its first place. A spec that puts a device in a place gives it the placement too (`standingIn`,
  `test/unit/support/placed.ts`), or every read about the past finds the place empty (the redesign session of
  2026-11-12).
- **Names are unique without an index:** a place's name among its owner's places that have not ended, a room's among
  its rooms, compared by `nameKey` (`common/v1/space-names.ts`: blanks and case make no second name). The comparison
  is not a field, so nothing in MongoDB states it; every write of a name goes through `refuseTakenName`, or through
  `freeNameFor` where the server names a place itself and must not refuse (a claim).
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
- **A new index outside `users` and `devices` needs no migration step:** it is declared on the schema and built
  at the next boot. `alerts` got `{ spaceId: 1, resolvedAt: -1, id: -1 }` that way (2026-11-13), for the read of
  what is over by when it ended, beside `{ spaceId: 1, resolvedAt: 1, startedAt: -1 }` for what is open.
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
  included, in the bucket ([server.md](server.md) has how they are served). A turn the grower asks for in the photo
  entry travels as `rotate` with the upload and is applied by the server on top of the EXIF orientation, rather than
  re-encoded in the browser: a canvas cannot read HEIC everywhere and iOS caps its size below a 24 MP photo.

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
  `/live` is one `last()` over 30 days. `history()` adds each output's switchings, because a mean turns a lamp
  into a duty cycle: at a grain of five minutes at the most, and at the window's own step where that is finer
  (`switchingGrainFor`), so a zoom shows the second a dehumidifier came on and a compressor's four-minute rest.
  Within three days the lamp and an AIR's `day` are a read of their own at five seconds, so a lamp's stretch
  is its samples' on every zoom: 25 ms over a day and 67 ms over three at a sample every 5 s, beside the other
  reads.
- **Each drawn window's first and last sample** (`edgesQuery`, `edgesByWindow`; the redesign session of
  2026-11-13 after the fifth walk; what it is for: [server-engines.md](server-engines.md#read-models)): two
  `aggregateWindow` with the selectors `first` and `last` and `timeSrc: "_time"`, which keeps a selector's own
  instant where a window is otherwise stamped at its stop. Of one field - a sample carries all of them -,
  chosen once the series says which the device was heard in, so the read follows the series': 11 ms on a
  day and on a week, 40 ms on 120 days (18 and 43 ms for the two selectors apart).
- **An output's samples are counted per drawn window** (`countsQuery`, `figuresOf`; rule B of the redesign
  session, 2026-11-13; what it is for: [server-engines.md](server-engines.md#read-models)): one
  script with two `aggregateWindow(count)` beside the series' means - every sample of every output, and the
  samples above zero of those driven at a level and of the valve. A switch writes 0 or 1, so the samples it
  ran in are its mean times its count and it is left out of the second count: a filter on the value is what
  the store does not push down (four months of five outputs counted in 53 ms, counted above zero in 227 ms).
  The mean level is the series' own mean, off counting as the 0 it is. It replaces the read of the level
  while running and the valve's dose (`levelsQuery`) and costs, on the long tent below, 8 ms for 6 over a
  day, 15 for 14 over a week, 52 for 44 over a month and 183 for 158 over 120 days (medians of nine).
  Checked point by point against the raw samples of three tents at a day, a week and a month: no window
  differs. The store's windows are `[start, stop)`; the test double's are `(start, stop]`, which is why a
  spec seeds its samples off the grid.
- **The extremes of a window** (`extremesQuery`, asked with `SeriesRequest.extremes`, which only the Timeline
  sets): `aggregateWindow(min)` and `(max)` over the stored fields of the metrics asked for, in one script beside
  the mean, raw samples only - a day kept as its mean has none - and not at all at the five-second step, where a
  window is one sample. A window either end of which is a sentinel has no extremes.
- **A figure of VPD is a VPD that occurred, at every range** (the redesign session of 2026-11-12, after its
  critic's two walks). It is never worked out from the means of the windows a chart draws, nor from the extremes
  of its inputs: the coldest and the dampest sample of a window need not be the same one - a tent between 20.7
  and 31.5 °C and 38 and 58.8 % read as -0.53 to 1.64 kPa, of which no sample was below 0.4 or above 1.1 - and
  a window hours wide holds air of both halves of the day under one leaf offset, in a pattern that drifts
  through the days: the same climate read 0.92 to 1.2 kPa in one month and 1.0 to 1.1 in another. Each reading
  is worked out by itself (`workedOutBy`), judged day or night as a live reading is - by its own lamp level, a
  fan's own flag, a plug's schedule or what the cameras saw at its time - and a point is the mean of its
  readings, its low and high their lowest and highest, so a line cannot leave its own envelope. Up to three
  days (`MAX_SAMPLED_SECONDS`) the readings are the samples, read raw (`samplesQuery`): on the tent below a day
  costs 64 ms, a week would cost 476 ms and a month 2.2 s, and in Flux - a pivot and the deficit of every row
  are not pushed down - five times that. Beyond three days they are means over five minutes, pushed down
  (`grainsQuery`; `deficitGrainFor` widens the grain past four and a half months to keep the read within its
  limit): 17 ms a week, 50 ms a month, 88 ms two months and 182 ms four, against 11, 26, 45 and 85 ms at
  fifteen minutes - so five it is. The switchings are no longer
  read for the deficit at all. A day kept as its mean has that mean to go by. PPFD is one reading times a
  factor, so its extremes are the reading's.
- **A grain the lamp switched in is worked out from its own samples** (`switchedGrains`, `samplesInQuery`; the
  redesign session of 2026-11-13 after the fourth walk). A grain is judged day or night as a whole, and that
  one is neither: lit in six samples of ten it took the day's leaf offset for the air of all ten, and a
  week's lowest deficit read 0.80 kPa where no sample of it was below 0.90. Of two neighbouring grains in
  different halves the lit one is read sample by sample - the dark one is dark throughout; both where a
  fan's flag or a plug's schedule says the half - and its figure is the mean of every sample's own deficit,
  which is its lit and its dark part weighted by their readings. Only those grains: two a day, none where
  the grain's leaf temperature was measured (the half decides the offset and nothing else), none above 1,500
  of them. The read follows the grains', which say which they are, as unions of sixty stretches a script;
  it costs about a millisecond a stretch however they are bundled - 15 ms on a week, 60 ms on a month and
  232 ms on 120 days (238 grains, a sample every 5 s) after the grains' own 16, 49 and 202 ms. On the staged
  tent of the walk the week reads 0.90 to 1.11 kPa, as the five-minute means of its raw samples do, and
  every split grain equals the mean of its samples' deficits.
- **Beyond three days every step is a whole number of grains** (`stepFor`, `timeline-window.ts`; the redesign
  session of 2026-11-13 after the third walk): a point of 541 s held one grain or two and was off by up to
  0.09 kPa from the mean of what it drew. An automatic step is rounded up to the grain and one asked finer is
  widened to it, so the deficit is one computation on every such window.
- **A reading's VPD uses a leaf temperature only if that reading carries one** - a sample's own, and a grain's
  mean only where the grain held at least half as many leaf readings as air readings (`coveredGrains`; the
  count is a second yield of `grainsQuery` and costs 4 ms on a month and 26 ms on 120 days, 149 to 175 ms) - and `live()` takes the leaf only where it was written with the newest temperature: a leaf sensor that
  was taken out is still the newest of its field for a month and bent "now".
- **Building Flux:** queries are strings, so only values passing `SAFE_NAME`/`FIELD_NAME` and instants from a `Date` are
  interpolated, never request input (Chris, 2026-08-25; [server.md](server.md#security-decisions)).
- **One device per query, by tag equality.** `r["device_id"] == "<id>"` is pushed down to the index; `contains(value:
  r["device_id"], set: [...])` is not, so a `last()` behind it scans every series in the range - ranged over months, the
  alarm health loop's read never returned and took InfluxDB down (2026-09-24; [server-engines.md](server-engines.md)).
  An `or` chain over many ids fails with "Program is nested too deep". The home sparklines (`DataService.trends`) used
  `contains()` over 24 hours and held every home load back by 1.5-2 s on a copy of production; they are one read per
  device side by side now (2026-10-22).
- **The client's 10 s timeout is a socket timeout** and never fires on a busy connection: race reads against a budget
  of your own, as `newestSamplesOf` does.
- **Deletes** go through `POST /api/v2/delete` (the JS client has none) with `rawSamplePredicate` (spares
  `status_daily`) or `everySamplePredicate`.

## Retention and cleanup

| Job | When | What goes |
| --- | --- | --- |
| Climate retention (`modules/retention/`) | 03:00 server time; first pass 10 min after boot | Days older than the window (cut at UTC midnight) become one mean per field and day in `status_daily`, then their raw points go. Window: the space's `retention.climateDays`, else the owner's, else `RETENTION_CLIMATE_DAYS` (compose default 0: nothing is swept). 500 devices a pass, rotated by `devices.climateSweptAt`, 90 days of backlog each; last pass in `GET /admin/stats` (memory only). |
| Still thinning (daily), picture sweep (hourly) | per camera, removed ones included | See GridFS. Stills a diary line names or a grow shows as its cover are spared ([terp-cam.md](terp-cam.md), Stills). With `PREMIUM_ENFORCED` and `PREMIUM_FREE_RETENTION`, a camera without entitlement keeps stills `PREMIUM_FREE_STILL_DAYS` and films `PREMIUM_FREE_TIMELAPSE_DAYS`; off by default. |
| Cleanup (`modules/cleanup/`) | daily; first run 5 min after boot | After 7 days' grace: entries whose grow, space and device are all gone; media whose camera, grow and space are all gone and that no entry, grow cover or film, or avatar names (every export, therefore); GridFS files without a media row. Successful `message-cam-capture` lines at any age. |
| TTL indexes | MongoDB | `sessions`, `passwordResets`, `notificationLog` at `expiresAt`. |
| Account deletion | in the request; resumed 5 s after boot and hourly | What the account owns. Device rows stay claimable and keep their readings; its lines in other people's records stay, authorless. |

- While `legacy_images` stands, thinning and the cleanup spare every picture it names (`migrations/way-back.ts`); the
  hourly picture sweep does not. Dropping `legacy_images` hands those pictures to both.
- A summarised day keeps only means: switchings and the counts of an output's samples read raw samples only.
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
- **A device is exported for the days it stood there:** a grow's `climate.csv` takes every device that stood in the
  spaces the grow stood in (`spacesDuring`, `modules/v1/grow/grow-places.ts`) while it stood there, each over its own
  stay (`stoodIn`, `common/v1/device-placements.ts`; ADR 0001, "Places, rooms and where a device stood"). The rows
  are in time order across the devices, and the figures are rounded as the page rounds them: a metric by
  `METRIC_DECIMALS`, an output to a whole per cent of full output in its stored unit (`climateRows`,
  `modules/v1/grow/export-csv.ts`; the redesign session of 2026-11-12 - a swap of two controllers had written one
  device's twelve hours after the other's, and a minute's mean stood there with every digit it has).
