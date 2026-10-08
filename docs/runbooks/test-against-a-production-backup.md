---
summary: Running a separate stack on a copy of production data - to verify a migration or test the app against real data - without touching another stack, its volumes, or the real people in the data
updated: 2026-10-08
source: Chris (2026-09-19 own stack for a copy, 2026-09-22 the verification pass he asked for); sessions 2026-09-22..23 (four passes over a restored copy of the hosted database); restore.sh, migrate-check.sh, docker-compose.yaml and the server's notification channels as of 2026-10-08
paths:
  - restore.sh
  - migrate-check.sh
  - docker-compose.yaml
  - server/src/migrations/**
  - server/src/modules/v1/notification/**
---
# Testing against a copy of production data

The rules around it - personal data, the trimmed backup, the development devices, how a verification pass is run -
are in [testing-real-devices-and-data.md](../knowledge/testing-real-devices-and-data.md#copies-of-production-data).
This is the procedure.

## A stack of its own

A separate worktree, with a copy of a local stack's env file. Before anything starts, change in the copy:

- `MONGODB_DATABASE`, `INFLUXDB_ORG`, `INFLUXDB_BUCKET`: those of the install the backup comes from - the restore
  takes only these names out of it.
- `DOCKER_COMPOSE_NAME`: a name of its own. Left equal, `./up.sh` recreates the other stack's containers from this
  worktree.
- `DOCKER_MONGODATA_*`, `DOCKER_INFLUXDATA_*`: remove them. Copied, they point this stack at the other stack's data
  volumes, and the restore overwrites them.
- Every `*_PORT_EXTERNAL`: off the ports other stacks on the machine use, with `API_URL_EXTERNAL` to match
  (CLAUDE.md, "Launching the stack locally").
- `SMTP_SERVER`, the `VAPID_*` and the `TELEGRAM_*` values: empty, so nothing reaches a real person.

## Restoring without a server

Into empty databases, with no server started on them:
[backup-and-restore.md](backup-and-restore.md#restoring), up to and without the last `./up.sh`.

## Taking the webhooks out

Webhooks live in the data and fire from any server that boots on it; there is no setting that stops them. In mongosh
on the restored database, before the server's first start:

```js
db.users.updateMany({ 'notifications.channels.webhook': { $ne: null } }, { $set: { 'notifications.channels.webhook': null } })
db.alarmRules.updateMany({ 'delivery.custom.channel': 'webhook' }, { $set: { 'delivery.mode': 'routing', 'delivery.custom': null } })
```

A backup from before the app rewrite holds them in the old shape (`devices.alarms[]` with `actionType: 'webhook'`)
and the server would migrate it at boot: run the migration by hand first (below), then these two lines.

## Verifying a migration

For a backup older than migrations the code carries ([server/src/migrations/README.md](../../server/src/migrations/README.md)):

1. `./migrate-check.sh`: the preflight, listing every row the migration would refuse. Wait for
   `Nothing stands in the way of a migration.`
2. The rehearsal: `COMPOSE_PROJECT_NAME=<project> docker compose run --rm --no-deps server npm run migrate -- --dry-run`.
   Every transform, nothing written. Read the rejects for what they are, not only how many: a rule that drops the
   wrong rows reports them just as calmly.
3. The real run: the same without `-- --dry-run`.
4. Reconcile each `legacy_*` collection with its new one; the rows a step leaves behind by rule are counted in the
   `migrations` record.
5. The two webhook lines above, if the backup was in the old shape. Then `./up.sh`; the server's log must say
   `Migrations: nothing to do`.

## Signing in

The account `ADMINUSER_USERNAME` names has `ADMINUSER_PASSWORD` once the server has started. To use a real account
from the data - such as the `AGENT_TESTING_*` one, which has devices - set its password on this copy only: an admin
session from `POST /v1/sessions/automation` with `{ "token": "<AUTOMATION_TOKEN>" }` (sent as
`Authorization: Bearer <userToken>`), then `PATCH /v1/admin/users/<id>` with `{ "password": "..." }`. The id:
`db.users.findOne({ email: '<address>' }, { id: 1 })`.

## Real devices

Devices dial the API and MQTT addresses built into their firmware, so this stack has to take over the ports of the
stack they use (`API_PORT_EXTERNAL`, `MQTT_PORT_EXTERNAL`, `MQTTS_PORT_EXTERNAL`) - ask first, stop that stack, swap
back afterwards ([how](../knowledge/testing-real-devices-and-data.md#the-development-devices)). Only devices the
restored data knows get through the broker, and those then run what it says: its configurations, and the firmware on
their channels.

## The pass

Drive the app over the data, have each finding refuted or confirmed by a second agent, fix what holds, then restore
from scratch and run it all again until a pass comes through clean (Chris, 2026-09-22) - in detail in
[testing-real-devices-and-data.md](../knowledge/testing-real-devices-and-data.md#verification-passes).
