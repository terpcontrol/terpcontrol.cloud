# Migrations

The move from the shapes this server has always written to the model in
[`docs/adr/0001-app-rewrite-data-model.md`](../../../docs/adr/0001-app-rewrite-data-model.md).

Versioned, ordered, applied once each, recorded in `migrations`, and run at boot **before the server listens or
subscribes to MQTT** — `main.ts`, between building the application and letting it serve. `NestFactory.create`
builds every provider and opens the database connection but runs no lifecycle hook, so that is the one moment at
which the database is reachable and nothing is reading or writing it. A failure throws out of `bootstrap` and ends
the process.

## The state the server is in afterwards

The migration renames each old collection to `legacy_<name>` and builds the new one in its place. Two of the new
collections carry the name of an old one: `users` and `devices`. So the moment the migration has run:

- **The server reads the new collections and nothing else.** There is no code left that knows the old shapes: the
  modules that read them are gone together with their routes, and what replaced them was written against the
  collections this migration builds.
- **Nothing reads `legacy_*`.** It is the old database kept where it fell, and a later release drops it.
- **The indexes of `users` and `devices` are built by the runner rather than by mongoose.** Those two collections
  hold the old shapes under their own name until the rename happens, and mongoose builds a model's indexes as the
  model is compiled — which is before this runs. So the two models say `autoIndex: false`
  (`database/models.module.ts`) and the runner builds them itself once a run has finished.
- **Pictures are untouched.** The GridFS bucket is never rewritten: a `media` row keeps the `image_id` of the
  `images` row it was made from as its own `id`, so every file stays exactly where it is and is reachable by
  either id. InfluxDB is not rewritten either.

On an install with no old data — a fresh one, and the integration suite — **nothing is moved**: a collection with
no documents in it is not renamed aside. Every step still runs, finds nothing and records itself, so a later boot
has nothing to do.

## What the log says

A run reports as it happens rather than when it returns, so a long step names itself while it works and a run that
was killed leaves a log saying how far it got. `Migrations:` is the run, `Migration <name>` is a step:

```
Migrations: 13 of 15 to apply (2 already applied); checking the database first
Migrations: applying 003-fleet, 004-spaces, …
Migration 003-fleet starting (1 of 13)
Migration 003-fleet applied in 16 ms: deviceclasses.read=5, deviceClasses.written=5, …
…
Migrations: finished; 13 migrations applied in 1412 ms
```

A boot with nothing to do says so — `Migrations: nothing to do; all 15 of them have already been applied`. That
line is the difference between a database that is migrated and one the server never looked at, and silence is not.
A step that left rows behind is a warning rather than an info line and carries the count; a run that stops says
`Migrations: stopped at 003-fleet; nothing after that was written` before the report of why.

## A record that claims more than the database holds

A restore of a dump taken before the upgrade puts the old collections back, and `mongorestore --drop` drops only
the collections the archive carries — so a `migrations` record already in that database survives it. Every step
then counts as applied over a database that still holds every old shape: nothing is pending, nothing is renamed,
and the accounts are in a shape nobody can sign in to.

So the record is not believed on its own, and the question is asked of **each step it says has run** rather than
only of a full record. A step that ran has moved the collections it reads aside (`moves` on the step says which,
which the stale-record check reads), so finding one of them standing under its own name with old rows in it
says the record is describing a database that is no longer there. The server then **refuses to start** naming
them. Drop `migrations` and `migrationLock` and start again; `npm run migrate:check` asks the same thing.

**Unless the old data is there twice**, which is what a restore over a *migrated* database leaves: the
migration-day copy under `legacy_devicelogs` and the restore under `devicelogs`, because the archive carries only
the second name. Dropping the record and starting again is then the wrong answer and a quiet one - a step reads
its source under whichever name it currently has, and `legacy_*` is that name, so the run would transform the
migration-day generation and leave the restore exactly where it is. The boot and `migrate:check` refuse that
database in the same words (`preflight.ts`, `TwoGenerationsOfOldData`) and ask for the one thing that is not in
the data: which of the two copies is authoritative. Drop the other, then drop `migrations` and `migrationLock`.

A record of a run that stopped part way survives a restore exactly as a complete one does, and is the worse of
the two: a handful of steps count as applied, the rest transform freshly restored old data, and the boot
*succeeds* half-migrated. The collections no recorded step has reached yet are not asked about — that is
precisely where a resumable run leaves them.

## A row it cannot take stops it

A transform that meets a row it cannot carry records it with its reason and **stops the run there**. The steps
before it stay applied, the step that rejected is not recorded, and the next run repeats it and stops again - a
refusal that lasted one run would be no refusal at all.

That is deliberate, and it is the lesson of a rule that read a diary entry's flag as a deletion: it dropped every
line every grower had written, reported each one, and finished green. A report nobody has to read is not a
safeguard.

So the run ends in one of two places. Either the rows are fixed in the database and it is run again, or whoever
read the report decides that leaving them behind is the intention and says so - `--allow-rejects` on the command
line, `MIGRATION_ALLOW_REJECTS=true` where the server's environment is set, since nobody types a flag when a
container starts.

Read `--dry-run` first: it reports exactly the rows the real run would reject, and writes nothing at all. It is
the one thing that does **not** stop at a step that rejected something — it is read to find out what the real run
will refuse, and a rehearsal that stopped at the first such step would name that step's rows and say nothing
whatsoever about the transforms after it.

## The steps, in order

| | What it does |
| --- | --- |
| `001-picture-bytes-into-the-bucket` | Moves the payload of pictures written before the image store into the GridFS bucket. First, because it looks for those documents in `images` and everything after it has moved that collection aside. |
| `002-users` | `users` → `users`. Refuses two accounts under one `user_id`, as the preflight does before it. |
| `003-fleet` | `deviceclasses`, `devicefirmwares`, `devicefirmwarebinaries`, `claimcodes` → `deviceClasses`, `firmwares`, `firmwareBinaries`, `claimCodes`. Field renames only. |
| `004-spaces` | One `spaces` row per claimed device. |
| `005-devices` | `devices` → `devices`, reduced to what the device is. |
| `006-plans` | `devices.recipe` → `plans`. |
| `007-alarm-rules` | `devices.alarms[]` → `alarmRules`, and an open `alerts` row for each alarm standing triggered. |
| `008-cameras` | `devices.cloudSettings` + `hardwareInfo.webcam_*` → `cameras`, including a retired one for a device whose pictures outlived its stream. |
| `009-plan-templates` | `recipetemplates` → `planTemplates`. |
| `010-grows` | The lifecycle entries → `grows` with their phases and one placement. A device running a plan and never logged into a stage becomes a grow that starts with its step — unless no step of that plan carries a stage at all, which says nothing about what is growing and becomes no grow, counted as `grows.planWithoutStage` and named in the log. That is the ordinary shape of a plan: only the guided onboarding's reference plans ever wrote a stage, and the old app made no grow of one either. |
| `011-entries` | `devicelogs` → `entries`. The two lines a controller repeats until somebody fixes the fault behind them — `message-ext-sensor-fail` and `message-ext-sensor-deviate` — keep their newest 100 per device and the rest are left behind, counted as `entries.repeatedLeftBehind` and named in the log per device and in total. They are most of the collection and say nothing a hundred of them do not. |
| `012-media` | `images` → `media`. The bytes are not touched. |
| `013-retired-collections` | `passwordtokens`, `shares` and `chartpresets` aside, unmigrated by decision. |
| `014-one-line-per-task` | Drops the non-unique `taskId` index on `entries`, so the schema's unique one is built on the next boot. |
| `015-warnings-routing` | Writes `notifications.routing.warnings: []` into every account that has no such row, because a lean read answers what the document holds and not what the schema would default. Reads the new `users` and moves nothing aside. |
| `016-measurement-band` | Spreads every grow's single measurement `target` over `targetMin` and `targetMax` and drops the old key, for the same reason: a lean read answers what the document holds, and a definition stored before the band would reach a client with neither end. Reads the new `grows` and moves nothing aside. |

Each step declares the collections it reads as `moves` and the runner moves them aside before calling it; the move
is skipped when it has already happened, so a step that shares a source with an earlier one finds it already moved,
and a run that was killed after a rename repeats without ever touching the old data again. A step that has *not*
run has moved nothing, which is what the stale-record check reads that declaration for.

Every copy is an upsert by `id`, and every id a migration invents is derived from what the old document already
is (`ids.ts`), so a repeated run rewrites the same documents rather than making second ones.

## Running one by hand

```sh
MIGRATION_LOCALE=de npm run migrate      # the same, told what language this install's growers speak
npm run migrate:check                    # only what a run refuses to start on; writes nothing (same as `--check`)
npm run migrate -- --dry-run             # every transform, counts and rejects, writes nothing at all
npm run migrate                          # the steps the server runs at boot, over the same indexes, without the server
npm run migrate -- --allow-rejects       # the same, told that the rows it cannot take may be left behind
```

`migrate:check` is the one to run days before an upgrade: it is the preflight below and nothing else, so it costs
a few aggregations rather than a whole rehearsal, and it exits non-zero with the report on stderr. The dry run is
the rehearsal: it reads the whole database, runs every transform and writes nothing, not even the rename. Take it
against a copy of the database that is about to be migrated and read the rejects before the real run.

`MIGRATION_LOCALE` is the one thing the old database cannot be asked: an old account records no language at
all, and the eight measurement definitions a reconstructed grow is given - along with each account's own
language preference - are written once and are then that person's own words, which nothing translates again. A
shop whose growers are German sets it to `de` before the run rather than having every one of them rename the
same eight rows. `en` unless set.

**A rehearsal's duration is not the outage.** It is the one number anybody has for how long the server is down
during an upgrade, and it is not that number: the rehearsal reads every row and runs every transform and then
writes none of it, so the upserts, the index maintenance on them and the renames are all missing from it. How
much that is depends on how much the run writes, which is the one thing the rehearsal can say — it prints the
count of documents it built and threw away beside its duration, and says what the duration leaves out. Read a
rehearsal for its rejects and its counts; take the duration from a real run against a copy of the database.

**The command builds the indexes a boot has before it starts.** It opens a bare connection rather than building
the application, and a bare connection has no models on it - so without this every upsert by `id` would land in
a collection carrying `_id` and nothing else, and each one would read everything the step had written so far. It
registers the models of `database/models.module.ts` and awaits their index builds first, which is why `users` and
`devices` are still the exception here that they are at boot: they hold the previous release's shapes until the
run renames them aside, so their own indexes are built after the run, by the same code that builds them at boot.
A rehearsal registers nothing, because building an index creates the collection it is on.

## Going back is the backup

**There is no command here that undoes a run.** Take a `./backup.sh` before the upgrade, and check that it
restores — into a scratch database, on the machine that would have to do it — before the upgrade starts rather
than on the evening it is needed. That check is the whole of the way back, and a backup nobody has restored is
not one.

What the migration leaves is not a substitute for it, though it is why a restore is a restore of the old shapes
rather than an archaeology: the old collections stand untouched under `legacy_*` until the release that drops
them, and a step that has not run has not moved its sources at all. The picture bytes are never rewritten — the
first step moves an inline payload into the bucket and a `media` row keeps the `image_id` it was made from, so a
restored `images` row finds its file by the same id. The sweeps leave a picture the migration carried over alone
for as long as `legacy_images` stands (`way-back.ts`), which is what keeps those bytes there to be found.
InfluxDB is not touched at all.

## The preflight

`preflight.ts`, before the lock and before the first step, at boot and in the CLI alike. It finds nothing on a
database that can carry the transforms and the run goes on silently; it finds anything and **nothing is written
at all** — the process ends non-zero with the whole list on stderr.

It is there because a transform can reject a document and carry on, but cannot decide between two rows that both
claim to be the same thing: two accounts under one `user_id` own one set of devices, and which of them owns them
is not in the data. That is a question for a person, every such question is asked at once rather than one per
attempt, and the report carries what the answer turns on — for each row its `_id`, and the address, the date, the
state and the counts that tell it from the others.

**Every check counts what is in the collections.** None of them asks an index and none believes one: mongoose
builds a model's indexes in the background and swallows a build that failed, so a unique index added to a
collection that already held duplicates never finished, never said so, and is still listed as if it held.

What is checked is what a transform cannot survive — every unique index of the new collections against the rows a
transform would produce for it, every id derived from something that is not unique, and every reference that
would be copied pointing at a row that is not there. What is not checked is everything a transform already
answers for: a duplicate `class_id`, `firmware_id` or `alarmId` keeps the first row by decision, an unparseable
configuration is migrated without one, a claim code that names no device is dropped. Those are rejects on a run
that goes through.

## Rejects

A document a transform cannot take is recorded with its id and the reason and does not stop the run. The reject
says whether the document was dropped or written with the part it could not take left out — an unparseable device
configuration is the second kind. The first 200 go into the migration's own record, the count of all of them
goes with it, and every one of them goes to the log.

## Adding one

A step is `{ name, run(context) }` in `steps/`, added to the list in `steps/index.ts`. `name` is what the
record says has already run, so it is never changed once a release carrying it has shipped. Inside `run`:
`context.source(name)` reads a collection under whichever name it currently has, `context.renameAside(name)`
moves it, `context.write(collection, document)` upserts, `context.count(key)` counts and `context.reject(...)`
reports. A dry run is the same code with every write and every rename turned off, so a transform must not read
back what it has written — where one migration needs what another derived, it derives it again from the old data
(`ids.ts`, `grow-cycles.ts`, `device-facts.ts`).

Documents are read and written through the driver rather than through a mongoose model. The old shapes have no
model once their collection is renamed aside, and a transform has to produce a *complete* document: the model
says "none is null, never absent", and a default quietly filled in by mongoose would hide a field the transform
forgot to decide. `test/unit/migrations.spec.ts` is what checks the result, against the database
`test/fixtures/legacy-database.ts` builds in today's shapes: the transforms row by row, the counts, the rejects,
and that the run is idempotent, resumable and reversible. `test/specs/migrations.spec.ts` runs the three commands
above over the same fixture from outside, so what an operator reads is held to as well.
