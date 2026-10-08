---
summary: When ./up.sh stops on the MongoDB data or mongod refuses to start - what upgrade-mongodb.sh does, its path, what to do when a step fails, and the hosts that cannot follow (no AVX, Raspberry Pi)
updated: 2026-10-08
source: Chris (2026-10-01 - default mongo:9.0, up.sh stops with a hint, the compose default is the highest supported release); PR #126 and its test session 2026-10-01; upgrade-mongodb.sh, scripts/mongodb.sh, up.sh and docker-compose.yaml as of 2026-10-08; compose pull and up with a locally loaded image, tried 2026-10-08
paths:
  - upgrade-mongodb.sh
  - scripts/mongodb.sh
  - up.sh
  - docker-compose.yaml
---
# Upgrading the MongoDB data

MongoDB starts only on data whose featureCompatibilityVersion (FCV) its release accepts, and moves forward one
supported release at a time. `docker-compose.yaml` runs `mongo:9.0`, the highest release the stack supports, unless
`DOCKER_MONGODB_IMAGE` names another image. Background: [data-operations.md](../knowledge/data-operations.md#mongodb-versions).

## Symptoms

- `./up.sh` stops after pulling: `The MongoDB data is at featureCompatibilityVersion 8.2, but mongo:9.0 is MongoDB
  9.0. Run ./upgrade-mongodb.sh ...`. Nothing has been recreated yet; the stack runs on as it was. A deploy fails the
  same way until somebody runs the upgrade on that host.
- Brought up any other way, the `mongodb` container restarts in a loop and logs `Wrong mongod version` (exit code 62).
- `./up.sh` says the data is *newer* than the image: an older image is pinned. Set `DOCKER_MONGODB_IMAGE` to
  `mongo:<FCV>` or newer.

## The upgrade

`./upgrade-mongodb.sh`, then `./up.sh`. On a deploy host run both from the deploy directory with the deploy's
`TERPCONTROL_ENV_FILE` and `COMPOSE_OPTIONS`. The rest of the stack keeps running and reconnects after each restart.

The script:

1. reads the FCV - from the healthy container, or, when mongod refuses to start, from a throwaway mongod on the
   volume, whose refusal names it (`scripts/mongodb.sh`);
2. plans the path: `4.4 → 5.0 → 6.0 → 7.0 → 8.0 → 9.0`, or `8.2 → 8.3 → 9.0` for data already on a rapid release;
3. starts the data's own release (`mongo:<FCV>`) and backs it up with `./backup.sh mongo` to
   `backup-<date>-mongodb-<FCV>.mongodump` in the repository directory, and stops if that fails;
4. per step: starts the next release on the old FCV, waits for the healthcheck, raises the FCV
   (`setFeatureCompatibilityVersion`, confirmed from 7.0 on) and reads it back;
5. ends on the compose image. Run again, it reports `already at 9.0` and only recreates the container on that image.

Measured on 2026-10-01: `8.2 → 8.3 → 9.0` in 50 s for 1.7 GB, backup included. Not tried on real hardware yet: the
`4.4 → 9.0` path and the step back when a release does not start.

On a deploy host move the backup out of the deploy directory before the next deploy
([backup-and-restore.md](backup-and-restore.md#on-a-deploy-host)).

## When it fails

- `MongoDB <X> did not come up; going back to <Y>. The data is unchanged.` MongoDB 5.0 and later need AVX on x86 and
  ARMv8.2-A on ARM. The data stays on `<Y>`, and `./up.sh` only passes once `DOCKER_MONGODB_IMAGE=mongo:<Y>` pins
  it - for a CPU without AVX that is the `mongo:4.4.25` that `.env.sample` offers.
- `upgrade-mongodb.sh failed at line <n>`: run it again. It reads the FCV afresh, takes a new backup and goes on
  from where the data is. One test run died with mongod apparently killed during a stop (exit 137); the `mongodb`
  service has `stop_grace_period: 60s` since.
- A raised FCV is not undone by any image. Going back is the backup, restored into an empty MongoDB volume under the
  old image: pin it (`DOCKER_MONGODB_IMAGE=mongo:<old>`), remove the `mongodb` container and its volume
  (`<project>_mongodata`, unless `DOCKER_MONGODATA_VOLUME` names it), `./up.sh mongodb`,
  `./restore.sh <backup>.mongodump`, `./up.sh`. `./down.sh --volumes` would take the InfluxDB data with it.

## Hosts that cannot follow

- **A CPU without AVX** stays on `DOCKER_MONGODB_IMAGE=mongo:4.4.25`; `./up.sh` checks the data against 4.4 and the
  script has nothing to do.
- **A Raspberry Pi on the unofficial image** ([RASPBERRY-PI.md](../../RASPBERRY-PI.md)): the image does not say
  which release it holds, so `upgrade-mongodb.sh` refuses (`Cannot tell the MongoDB release of ...`). `./up.sh` does
  not get as far as its check: its pull fails on an image that was `docker load`ed and is in no registry, while
  `docker compose up --build -d --remove-orphans` uses it as it is (Compose 2.32, tried 2026-10-08). The official
  images the script would step through need ARMv8.2-A from 5.0 on, which a Pi 4 lacks.

## Raising the supported release

The compose default is the highest release the stack supports (Chris, 2026-10-01). Raising it means teaching
`next_release` in `upgrade-mongodb.sh` the way there in the same change; every host behind it is then stopped by
`./up.sh` and sent to the script.
