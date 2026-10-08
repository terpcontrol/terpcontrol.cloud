---
summary: Upgrading a self-hosted install from before the app rewrite (October 2026) - what the first start migrates, the checks before it, what to do when it stops, and the way back
updated: 2026-10-08
source: ADR 0001 and server/src/migrations/README.md (Chris, 2026-09); the upgrade procedure of 2026-09-19; commit 088440d1 (rollback command removed, 2026-09-20); the rebrand (2026-10-01..04); verified against migrate-check.sh, up.sh, .env.sample and server/src/migrations as of 2026-10-08
paths:
  - server/src/migrations/**
  - migrate-check.sh
  - up.sh
  - .env.sample
---
# Upgrading an install from before the app rewrite

The README's [upgrade steps](../../README.md#upgrading--restarting) hold; this is what differs the first time. The
first start of the new server migrates the database to the model of
[ADR 0001](../adr/0001-app-rewrite-data-model.md): each old collection is renamed to `legacy_<name>` and the new ones
are built beside it. Accounts, devices, diary, plans, alarms and pictures come along; share links and saved chart
views do not. Devices need nothing.

## Before

1. `./backup.sh`, and restore it once somewhere else, so that it is known to restore: it is the only way back
   ([backup-and-restore.md](backup-and-restore.md)).
2. Leave the directory where it is. Without `DOCKER_COMPOSE_NAME` the compose project, and with it the names of the
   data volumes, comes from the directory's name - a clone from before the rebrand lives in `fg2/`, and renamed it
   would start on empty volumes. Point the clone at the repository's new address if it still has the old one:
   `git remote set-url origin https://github.com/terpcontrol/terpcontrol.cloud`.
3. `git pull`, then compare `.env` with `.env.sample`. Where the growers are not English speakers, set
   `MIGRATION_LOCALE` (e.g. `de`) before the first start: the migration writes each account's language and the names
   of each migrated grow's measurements once, in that language.
4. `./migrate-check.sh`: the preflight, which writes nothing. What it lists - two accounts under one id, references to
   rows that are not there - has to be fixed in the database first; repeat until it says nothing stands in the way.
5. Optional, against a copy: the rehearsal (`npm run migrate -- --dry-run` in the server container,
   [test-against-a-production-backup.md](test-against-a-production-backup.md#verifying-a-migration)) prints the
   counts and every row the real run would reject. Its duration is not the downtime: it writes nothing.

## The first start

`./up.sh`. If it stops before anything starts, the MongoDB data is older than the image:
[mongodb-upgrade.md](mongodb-upgrade.md). The server is down while the migration runs, which takes minutes on a large
database. The log reports each step (`Migration <name> ...`) and ends with `Migrations: finished`; every later start
says `Migrations: nothing to do`.

A row a step cannot carry stops the run, and the server with it, naming the rows; the container then restarts into
the same refusal. Either fix the rows and `./up.sh server` again, or - after reading the report - set
`MIGRATION_ALLOW_REJECTS=true` in `.env` to leave them behind, `./up.sh server`, and empty it again afterwards. A
step reads its rows from `legacy_<name>` once the run has moved that collection aside, so that is where a refused
row is fixed ([data-operations.md](../knowledge/data-operations.md#migrations-in-operation)).

## Going back

No command undoes a migration. The way back is the backup with the old code: check out the commit you came from,
empty both databases (`./down.sh --volumes`, or `docker compose down --volumes` where that commit has no
`down.sh`), start the stack, `./restore.sh <backup>`, restart the server. Whatever was written since the upgrade is
lost.

The `legacy_*` collections stay untouched until a later release drops them. Nothing reads them, but they are what a
wrong transform can be checked against and put right by hand.

## Hardware

The server and the web app build on Node 24 now, which - like the MongoDB and InfluxDB images - has no 32-bit ARM
build: a Raspberry Pi needs a 64-bit OS ([RASPBERRY-PI.md](../../RASPBERRY-PI.md)).
