---
summary: Backing up and restoring a stack beyond the README's commands - what a backup holds and misses, one-database backups, deploy hosts, restoring into a migrated database or from another install
updated: 2026-11-27
source: the S3 bucket for pictures (2026-11-27); backup.sh, restore.sh, scripts/compose.sh and server/src/migrations/README.md as of 2026-10-08; commits 2025-10-30..2026-10-06; the production hotfix of 2026-09-23 (backup on a deploy host); a failed scheduled backup and the disk peak measured on 2026-11-26; the full disk the nightly backup caused on 2026-11-27
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
- **Not in it:** an S3 bucket the pictures are stored in (`S3_BUCKET`, [data.md](../knowledge/data.md)) - the dump
  then holds only what has not been moved yet. Back the bucket up with the provider's tools.
- **Not in it either:** the env file and `mqtts-ca.key`. Keep both beside the backup. Devices have the API address, the MQTT
  host and the MQTTS CA built into their firmware, so an install restored elsewhere has to answer at the same
  addresses and serve a certificate signed by the same CA ([mqtts-certificates.md](mqtts-certificates.md)).

## Options

| Command | What it does |
| --- | --- |
| `./backup.sh mongo`, `./backup.sh influx` | one database only. `mongodb` has to be running in any case, `influxdb` unless the argument is `mongo` |
| `BACKUP_FILENAME=<dir>/<name> ./backup.sh` | where the files go: a path prefix without extension, default the current directory |
| `BACKUP_RESERVE_GB=<n> ./backup.sh` | free space that has to remain beside the backup, default 5 |
| `./restore.sh <name>` | both files |
| `./restore.sh <name>.mongodump` (or `.influxdump`) | that one only |

The Mongo dump is streamed straight to the host. The InfluxDB backup has to be a directory in the container first;
its tar is streamed out and the directory removed before the Mongo dump starts. So the peak is about twice the
InfluxDB backup, or the InfluxDB file plus the Mongo dump, whichever is larger - about 33 GB for a 17.7 GB Mongo and a
15 GB Influx backup (2026-11-27; the version before streamed nothing and peaked at about 63 GB). A scheduled backup
that keeps earlier files until the new ones are written needs that on top of them, and a cleanup by age
(`find -mtime +0`) keeps a manual backup from the day before as well.

Before each step `backup.sh` estimates the size from the database (the data size of all MongoDB databases, the size
of InfluxDB's engine directory - both a little above the real files) and stops with `not enough disk space` when the
free space minus `BACKUP_RESERVE_GB` (default 5) would not hold it: a backup that runs the disk full takes down the
databases of every stack on it ([data-operations.md](../knowledge/data-operations.md#disk-space)). On any failure it
removes what it left in the containers and its unfinished `*.partial` file, and ends with `BACKUP FAILED` on stderr;
only complete files carry the backup's name.

## On a deploy host

- Pass what the deploy passes: `TERPCONTROL_ENV_FILE=<env-file> COMPOSE_OPTIONS='<options>' ./backup.sh`. Without
  them the scripts read `./.env`, which a deploy never ships (its rsync excludes `.env` and `.env.*`), and may address
  another compose project than the running one.
- Write outside the deploy directory: `BACKUP_FILENAME=<backup-dir>/backup-$(date +%F_%H-%M-%S)`. The next deploy's
  `rsync --delete` removes every file there that the repository does not have, backups included.
  `upgrade-mongodb.sh` always writes its backup into the repository directory - move it out before the next deploy.
- A scheduled backup that runs from its own copy of `backup.sh` and `scripts/` outside the deploy directory is not
  refreshed by a deploy: copy both again from master when they change. Such a copy from before PR #183 stopped at
  its first line once the env file carried `CUSTOM_SCRIPT_TAG` - `load-env.sh` exports the file through `xargs`, a
  value with spaces or quotes breaks that, `backup.sh` runs under `set -e`, and cron's output went nowhere, so the
  backup failed silently (2026-11-26). Check that the newest backup carries today's date: a backup the space check
  refuses is just as silent there.
- Production's scheduled copy got the `backup.sh` of PR #198 before it was merged (Chris, 2026-11-27: the old
  script would have run the disk full again the next night); the replaced one is kept beside it with a `.bak-<date>`
  suffix. After the merge, compare the copy with master's `backup.sh` and copy again if review changed it.
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

## Raspberry Pi

The unofficial MongoDB image of the Pi setup does not work with these scripts. Back up its volumes by hand with the
stack stopped ([RASPBERRY-PI.md](../../RASPBERRY-PI.md)).
