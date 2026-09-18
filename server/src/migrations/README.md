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
- **Nothing reads `legacy_*`.** It is the way back and nothing else, and a later release drops it.
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

## The steps, in order

| | What it does |
| --- | --- |
| `001-picture-bytes-into-the-bucket` | Moves the payload of pictures written before the image store into the GridFS bucket. First, because it looks for those documents in `images` and everything after it has moved that collection aside. |
| `002-users` | `users` → `users`. Aborts the whole run if two accounts share a `user_id`. |
| `003-fleet` | `deviceclasses`, `devicefirmwares`, `devicefirmwarebinaries`, `claimcodes` → `deviceClasses`, `firmwares`, `firmwareBinaries`, `claimCodes`. Field renames only. |
| `004-spaces` | One `spaces` row per claimed device. |
| `005-devices` | `devices` → `devices`, reduced to what the device is. |
| `006-plans` | `devices.recipe` → `plans`. |
| `007-alarm-rules` | `devices.alarms[]` → `alarmRules`, and an open `alerts` row for each alarm standing triggered. |
| `008-cameras` | `devices.cloudSettings` + `hardwareInfo.webcam_*` → `cameras`, including a retired one for a device whose pictures outlived its stream. |
| `009-plan-templates` | `recipetemplates` → `planTemplates`. |
| `010-grows` | The lifecycle entries → `grows` with their phases and one placement. |
| `011-entries` | `devicelogs` → `entries`. |
| `012-media` | `images` → `media`. The bytes are not touched. |
| `013-retired-collections` | `passwordtokens`, `shares` and `chartpresets` aside, unmigrated by decision. |

Each step moves the collections it reads aside itself, and the move is skipped when it has already happened — so
a step that shares a source with an earlier one finds it already moved, and a run that was killed after a rename
repeats without ever touching the old data again. Every copy is an upsert by `id`, and every id a migration
invents is derived from what the old document already is (`ids.ts`), so a repeated run rewrites the same
documents rather than making second ones.

## Running one by hand

```sh
npm run migrate -- --dry-run   # every transform, counts and rejects, writes nothing at all
npm run migrate                # what the server does at boot, without the server
npm run migrate:rollback       # drop the new collections, put legacy_* back
```

The dry run is the rehearsal: it reads the whole database, runs every transform and writes nothing, not even the
rename. Take it against a copy of the database that is about to be migrated and read the rejects before the real
run. `migrate:rollback` is the way back for one release — it refuses on a database that holds no `legacy_*`
collection, and **everything written since the migration is lost** when it does run.

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
