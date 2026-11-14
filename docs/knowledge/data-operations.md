---
summary: Operating the data - MongoDB version upgrades, the boot migration in practice (rejects, re-runs, duration), shapes old data has in real databases, backups and restores; read it before an upgrade, a restore or a repair by hand
updated: 2026-11-14
source: step 032 (the redesign session of 2026-11-14, after the fourth whole-app walk); step 031 (Chris, 2026-11-13; built by the redesign session's final fix round); Chris (decisions in sessions and PR reviews, 2026-09-17..10-06); steps 026-028: the redesign session of 2026-11-12; agent sessions on the migration and on upgrades, 2026-09-17..10-06; PRs #29, #69, #126, #134, #135, #141; codebase cleanup (2026-10-08); checked against the code on 2026-10-08
paths:
  - server/src/migrations/**
  - backup.sh
  - restore.sh
  - upgrade-mongodb.sh
  - migrate-check.sh
  - up.sh
  - scripts/mongodb.sh
---
# Data operations: upgrades, migrations, old data, backups

Where the data lives and the rules for code are in [data.md](data.md). The migration was decided in
[ADR 0001](../adr/0001-app-rewrite-data-model.md#migration); its runner, steps, commands and refusals are explained in
[`server/src/migrations/README.md`](../../server/src/migrations/README.md), the everyday commands in the
[README](../../README.md#upgrading--restarting). The procedures are runbooks:
[upgrade a pre-rewrite install](../runbooks/upgrade-a-pre-rewrite-install.md),
[MongoDB upgrade](../runbooks/mongodb-upgrade.md), [backup and restore](../runbooks/backup-and-restore.md),
[test against a production backup](../runbooks/test-against-a-production-backup.md). This document holds the
background they rest on.

## MongoDB versions

`docker-compose.yaml` pins `mongo:9.0`, the newest release supported; raising it means teaching `upgrade-mongodb.sh`
the way there (Chris, 2026-10-01). An image whose release does not accept the data's featureCompatibilityVersion (FCV)
exits with code 62 and leaves the data intact - what an unpinned `mongo` did when `latest` became 9.0; an image
matching the FCV starts it again. `./up.sh` compares FCV and image before it recreates `mongodb`, prints what to do
and exits 1 on a mismatch; it never upgrades by itself, since an FCV raise cannot be undone, and cannot check an image
that hides its release (the unofficial Raspberry Pi build, where `./up.sh` already stops at the image pull - the
guide starts that stack with `docker compose up`). `./upgrade-mongodb.sh` backs up, then moves one release
at a time and raises the FCV after each; its path, its failures and the hosts that cannot follow (no AVX, Raspberry
Pi) are in the [MongoDB upgrade runbook](../runbooks/mongodb-upgrade.md).

## Migrations in operation

- **Every reject stops a real run** unless `--allow-rejects`/`MIGRATION_ALLOW_REJECTS=true` - also those that keep the
  row (an unparseable configuration; a duplicate `class_id`, `firmware_id` or `alarmId`). The README's "Rejects"
  section still says otherwise; the runner wins.
- **A step reads its sources from `legacy_<name>` once moved,** so fixing a refused row in the new collection changes
  nothing - fix it in `legacy_*`. Steps already applied miss that fix: on 2026-10-04 an `owner_id` set in
  `legacy_devices` let `008-cameras` pass after 004, 005 and 007 had written the device ownerless - a device with an
  owner and no space, repaired by hand the way 004 would have written it.
- **`008-cameras` refuses a device with an RTSP stream and no owner,** because the URL carries the last owner's
  credentials. After reading the report, pass it with `MIGRATION_ALLOW_REJECTS=true`; a Terp Cam is re-created at the
  first hardware report after a claim. Counting such devices instead (PR #135) was closed by Chris on 2026-10-06.
- **InfluxDB is rewritten once:** `020-retired-dryers` deletes every dryer's points, raw and daily, so the store has to
  be reachable when a database with dryers is migrated.
- **Some steps run live code:** `011-entries` the device-message parser (`common/v1/device-messages.ts`), `017` the
  credential filter of `common/log-path.ts`, `018` and `021` `targetsOf`, `019` and `021` the class rules, work modes
  and plan steps of the server, `020` the Influx delete predicate, `002`, `021` and `028` modules of `shared-types` (`028`: `nameKey` and `numbered` of `place-names.ts`).
  Changing one changes what that step writes on every install not yet migrated, while migrated ones keep the old
  result: a refactor there leaves each step's output as it was (the step specs and a dry run on a copy show it), and
  a new meaning for migrated data is a new step.
- **Steps on the new collections** (`026-device-placements`, `027-empty-rooms`, `028-unique-place-names`; the
  redesign session of 2026-11-12, ADR 0001 "Places, rooms and where a device stood"): they read `devices` and
  `spaces` in the new shape, move nothing aside and reject nothing. Each finds its work by what is still wrong - a
  device without `placements`, a room that has not ended and holds no place, two names that collide - so a second run
  changes nothing and a run killed half-way continues. A database from the old cloud has no rooms, so 027 finds none
  there; 028 renames only the places of one owner that were named after devices sharing a name (step 004 numbers
  the places it names itself). 026 dates a placement from `state.claimedAt`, which step 005 leaves null for every
  device carried over, and then from the device's `createdAt`: a carried-over device has stood in its place since it
  registered, which is what every read assumed before. On a restored copy of a migrated database (2026-11-12,
  by the runbook, on a stack of its own) the three steps took 10 ms of a run of under 0.1 s: every device with a
  place got one open placement, the unclaimed ones an empty list, no room was found, one place was renamed, and
  the second run and the boot after it said "nothing to do". Two more of the same kind follow (the redesign
  session of 2026-11-13; run in unit tests, not yet on a restored copy): `029-reminders-of-ended-places` deletes
  the reminders about a place or room that has ended - ending a place left them behind until then, so any
  database that ran the rewrite can hold some (the session's test stack held four) - and
  `030-open-alerts-where-the-device-stands` gives every open alert the place its device stands in now (both since
  verified on a copy of production data, see the handover). `031-hand-set-phases` (Chris, 2026-11-13; unit tests
  only) gives every phase stored as `preset` to a person - its `setBy` where one was stored, else the grow's owner -
  with its diary line, since the data cannot tell a phase set on the grow page from a preset applied under
  Steuerung and only a plan writes `plan`; counted as `phases.givenToTheirPerson` and `entries.givenToTheirPerson`.
  `032-resting-reminders-of-ended-grows` (the redesign session of 2026-11-14, after Chris's answer; unit tests only)
  rests the reminders of a grow that has ended - `restingSince` its end, off every list until the grow is reopened -
  and deletes those of a grow that is gone, counted as `reminders.restingWithAGrow` and `reminders.goneWithAGrow`:
  ending or deleting a grow left them under Rhythmen until then, so any database that ran the rewrite can hold some.
  A deleting version named `032-reminders-of-ended-grows` ran on the session's own test stack and never shipped; a
  record holding that name is answered by no step, and the resting step runs on the next boot.
  Its reads are empty over "the last 24 hours" for a
  reason that is not the migration: a backup's readings end on the day it was taken, so a place's curves are checked
  there with `?at=` on that day, and a grow's diary on its older pages.
- **Duration:** the real run on a copy of the hosted database took 1.5 to 2 minutes (93-115 s for the 17 steps of
  2026-09-23) once the command built its indexes first and `011-entries` thinned the repeated sensor lines, nearly all
  of it `011-entries`. A dry run writes nothing and under-reports (6x before the thinning).
- **Names:** old collections are lower case (`claimcodes`, `deviceclasses`, `chartpresets`, ...); only `users` and
  `devices` share a name with the new ones. An old collection that was empty is never renamed and has no `legacy_` twin.
  No release drops `legacy_*` yet; until one does, the picture sweeps spare what `legacy_images` names
  ([data.md](data.md)).
- **TypeScript, not JavaScript inside MongoDB** (Chris asked, 2026-09-19): server-side JavaScript is gone since 4.2
  outside aggregation, and pipelines would lose the per-row reject report.

## Legacy shapes in real databases

In `legacy_*`, in what the migration carried over, and in InfluxDB; `migrations/legacy.ts` reads them.

- **Instants** are epoch milliseconds as Numbers, `0` meaning never (`images.timestamp`: compare with `Date.now()`).
- **Flags and numbers** were cast by Mongoose, so `1`, `'1'`, `'true'`, `'yes'` are true and `'30'` is 30. Read them
  with `flagOf`/`numberOf` - `===` would deactivate accounts and demote admins - and look values up with `fromTable`.
- **`owner_id: ''`** is unowned. **`configuration`** is a JSON string; absent, empty and unparseable become `null`
  ("never reported"), and the device sends its settings when it connects (PR #141).
- **Device MQTT passwords** are re-hashed on a device's successful broker sign-in when the stored form is not the
  current one (`utils/devicepassword.ts`).
- **`devicelogs`:** the kind is `categories[1]`; lifecycle lines carry `diary-plant-lifecycle` or `plant-lifecycle`.
  `deleted: true` means "not interesting on the device card" - set on every diary entry, while a real deletion removed
  the row (Chris, 2026-09-18). Read as a deletion it once dropped every grower's diary and finished green. A line a
  client wrote with its key already resolved carries the old app's English heading ("Plant log entry", "User
  measurement", ...) instead; `011-entries` drops those (`RENDERED_TITLES`) and keeps what the grower typed.
- **Alarms** (`devices.alarms[]`) may watch an output rather than a reading. A heater's thresholds are percentages,
  because the old engine multiplied that output (0..1) by 100; `007-alarm-rules` divides them, and its header lists
  what else it decides.
- **Duplicates:** real databases held two accounts under one `user_id` and addresses shared by several accounts. The
  preflight names them and nothing runs until a person has decided (migrations README, "The preflight").
- **`images`:** `format` `jpeg` (still), `mp4` (timelapse; `duration` `1d`/`1w`/`1m`; `timestamp` starts its period)
  or `user/jpeg` (photo). Rows from before GridFS held their bytes in `data` - project it away; `001` moved them.
- **A paired Terp Cam** was `cloudSettings.rtspStream` = `terpcam://<id>` or `okam://<id>`.
- **Camera passwords in diary lines:** failed RTSP captures quoted ffmpeg's command line, `rtsp://user:password@`
  included, into `message-rtsp-stream-error` params and free text; `017-entry-credentials` strikes them, the entry
  writer redacts at ingest since.
- **Migrated diary photos hang on `note` entries**, not `photo` ones: count pictures by `mediaIds`.
- **Alarm lines** are stored as composed English text in `message.params` (`message-alarm-triggered-text` is
  `{{value}}`), so wording changes never reach stored lines; older offline lines say "quiet for" and were left alone.
- **Migrated accounts** have `createdAt` from the ObjectId and `timezone: UTC` with `timezoneChosen: false`.
- **InfluxDB:** older points carry a `user_id` tag (never read). CO2 sentinels - `co2` −1 (no SCD) or a flat 0
  (plug), `out_co2` −1 or 4294967295 (−1 as uint32) - are no longer written and are dropped on read
  (`common/v1/sentinels.ts`); `co2=off` in the hardware report hides a removed sensor's old values - a controller's only: a fridge always has its
  sensor, and `023-fridge-co2-sensor` removed the stale `co2` a fridge had carried over from a build of another type.

## Backups and restores

The way back from an upgrade is a backup proved restorable beforehand
([ADR 0001](../adr/0001-app-rewrite-data-model.md#going-back)). What a backup holds and misses, and the steps, are in
the [backup-and-restore runbook](../runbooks/backup-and-restore.md); what they rest on:

- A Mongo dump is the whole database, pictures and films included (GridFS, [data.md](data.md)) - where cameras run,
  most of its size.
- A restore goes by name and replaces: `mongorestore --drop` takes only `${MONGODB_DATABASE}.*` - a dump of a database
  under another name restores nothing - and drops only the collections the archive carries; InfluxDB's bucket is
  deleted and restored, so readings written since the backup are gone.
- **Old data and a migrated database do not mix.** Over a migrated database the restored old collections stand beside
  their `legacy_*` twins and the boot refuses (`TwoGenerationsOfOldData`); after a boot on an empty database the
  `migrations` record claims every step and the boot refuses the old data as stale. So a dump from before the rewrite
  goes into empty databases no server has booted on; the migrations README says what to do otherwise.
- A restored copy reaches real people from its first boot: mail, Web Push and Telegram where its `.env` configures
  them, the webhooks stored in the data always - see
  [test against a production backup](../runbooks/test-against-a-production-backup.md).
