---
summary: Backing up and restoring a stack beyond the README's commands - what a backup holds and misses, one-database backups, deploy hosts, restoring into a migrated database or from another install
updated: 2026-10-08
source: backup.sh, restore.sh, scripts/compose.sh and server/src/migrations/README.md as of 2026-10-08; commits 2025-10-30..2026-10-06; the production hotfix of 2026-09-23 (backup on a deploy host); restoring the focused backup on a busy machine (2026-10-08)
paths:
  - backup.sh
  - restore.sh
  - scripts/compose.sh
  - scripts/load-env.sh
---
# Backing up and restoring a stack

The everyday commands are in the README ([Backup](../../README.md#backup), [Restore](../../README.md#restore)), the
background in [data-operations.md](../knowledge/data-operations.md#backups-and-restores). This is what an operator
needs beyond them.

## What a backup holds

`./backup.sh` writes `<name>.mongodump` and `<name>.influxdump`; `<name>` defaults to `backup-<date>_<time>`.

- The MongoDB dump: accounts, devices with their broker credentials, diary, plans, alarms, firmware builds, and the
  pictures and timelapses (GridFS bucket `imagedata`). `restore.sh` takes only the database `MONGODB_DATABASE` out
  of it.
- The InfluxDB backup: every reading, the daily summaries included (they live in the same bucket,
  `INFLUXDB_BUCKET`).
- **Not in it:** the env file and `mqtts-ca.key`. Keep both beside the backup. Devices have the API address, the MQTT
  host and the MQTTS CA built into their firmware, so an install restored elsewhere has to answer at the same
  addresses and serve a certificate signed by the same CA ([mqtts-certificates.md](mqtts-certificates.md)).

## Options

| Command | What it does |
| --- | --- |
| `./backup.sh mongo`, `./backup.sh influx` | one database only. `mongodb` has to be running in any case, `influxdb` unless the argument is `mongo` |
| `BACKUP_FILENAME=<dir>/<name> ./backup.sh` | where the files go: a path prefix without extension, default the current directory |
| `./restore.sh <name>` | both files |
| `./restore.sh <name>.mongodump` (or `.influxdump`) | that one only |

The dump is written inside the container first and then copied out, so a backup briefly needs two to three times
its size on the Docker host.

## On a deploy host

- Pass what the deploy passes: `TERPCONTROL_ENV_FILE=<env-file> COMPOSE_OPTIONS='<options>' ./backup.sh`. Without
  them the scripts read `./.env`, which a deploy never ships (its rsync excludes `.env` and `.env.*`), and may address
  another compose project than the running one.
- Write outside the deploy directory: `BACKUP_FILENAME=<backup-dir>/backup-$(date +%F_%H-%M-%S)`. The next deploy's
  `rsync --delete` removes every file there that the repository does not have, backups included.
  `upgrade-mongodb.sh` always writes its backup into the repository directory - move it out before the next deploy.
- A tree from before 2026-09-18 (a hotfix on an old base) has a `backup.sh` that ignores `COMPOSE_OPTIONS`. Where the
  project name comes from a `-p` flag there, run `mongodump` in the container directly.

## Restoring

- Stop the server first (`./stop.sh server`) and keep `mongodb` and `influxdb` running; `./up.sh` afterwards. The
  server migrates restored old data at its next start.
- `mongorestore --drop` drops only the collections the archive carries. A dump from before a migration, restored
  into a database that has been migrated since, therefore leaves the `migrations` record, the collections the
  migration built and its `legacy_*` copies beside the restored old ones. The server refuses to start on that and
  says what it found. The clean way is an empty database:

  ```sh
  ./down.sh --volumes        # throws away both databases of this stack
  ./up.sh mongodb influxdb   # the databases only
  # wait until `influx ping` in the influxdb container answers: it has no healthcheck and sets itself up after starting
  ./restore.sh <name>
  ./up.sh
  ```

  Only the databases: a server that has once started on the empty database records every migration as done, and the
  old data restored afterwards is then refused as stale. `--volumes` leaves external volumes
  (`DOCKER_*DATA_EXTERNAL=true`) alone; remove those by hand. Where the database cannot be emptied, what to drop is in
  [server/src/migrations/README.md](../../server/src/migrations/README.md#a-record-that-claims-more-than-the-database-holds).
- A backup of another install restores only into the same names: `MONGODB_DATABASE`, `INFLUXDB_ORG` and
  `INFLUXDB_BUCKET` must be that install's. The InfluxDB token is the target's own and may differ.
- Restored accounts keep their passwords, except the one `ADMINUSER_USERNAME` names: the server sets it to
  `ADMINUSER_PASSWORD` at every start.
- **A restore that ends without a word is a killed `mongorestore`** (exit 137): it runs inside the database's
  container, and on a machine running several stacks the Docker VM runs out of memory on the picture chunks
  (`imagedata.chunks`, about 2 GB in a focused backup). `restore.sh` then stops silently after its Mongo step. Run the
  restore by hand with `--numParallelCollections=1 --numInsertionWorkersPerCollection=1 --batchSize=20`, and if that
  is killed too, start that `mongodb` with a small cache through a compose override
  (`command: ["mongod", "--wiredTigerCacheSizeGB", "0.25"]`) for the restore; recreating the container drops the
  archive copied into it, so copy it again.

## Raspberry Pi

The unofficial MongoDB image of the Pi setup does not work with these scripts. Back up its volumes by hand with the
stack stopped ([RASPBERRY-PI.md](../../RASPBERRY-PI.md)).
