---
summary: Shipping a fix to the hosted production stack while it cannot take master yet - patch branch, approval, read-only inspection, a deploy that mirrors the production commit's own workflow, and the checks afterwards
updated: 2026-10-08
source: Chris's decisions in the hotfix of 2026-09-23 (session e425000f); .github/workflows/deploy*.yml, .github/actions/sync-to-host and up.sh as of 2026-10-08
paths:
  - .github/workflows/deploy.yml
  - .github/workflows/deploy-cloud.yml
  - .github/workflows/deploy-firmware.yml
  - .github/actions/sync-to-host/action.yml
  - up.sh
---
# A hotfix for production on an older base

For when production runs an older commit than master and cannot take master yet, for example while a migration on
master is still being verified. The regular way is the Deploy workflow (`deploy.yml`), whose `production-cloud`
step waits for approval.

## Branch

1. Find the commit production runs: the GitHub run of its last production deploy names it. The tree in the deploy
   directory proves nothing - a tree can be rsynced without the rebuild that should follow it (seen 2026-09-23).
2. `git switch -c patch-<date> <production-commit>` and cherry-pick the fix from master. A conflict over a file that
   does not exist at that base is resolved by leaving the file out; the commit message says what that drops.
3. Push to `patch-<date>` only. Never to master, and no pull request into master: it would propose reverting
   everything master gained since. The workflows stay as they are; the deploy is manual and one-off
   (Chris, 2026-09-23).

## Before asking for approval

- Run the affected tests and `npm run build` at that base. CI at an older base may only ever have built, so unrelated
  suites can fail there; compare with the base commit before blaming the fix. A base from before the NestJS move
  needs a local env file first ([testing](../knowledge/testing.md#on-an-older-base)).
- Verify the behaviour on a local stack built from the branch. `simulate-device.sh` and other tooling may not exist
  at the base.
- Work out what a rollback would mean: data the fix writes in a new shape may be unreadable for the old code (on
  2026-09-23, pictures written to GridFS that the old serving path could not read). Say so in the request.

## Approval and inspection

Chris approves the exact list of commands before anything runs against the production host. The read-only
inspection comes first and is on that list too:

- the compose project the running containers belong to: `docker compose ls`, and the labels
  `com.docker.compose.project` and `com.docker.compose.project.working_dir` in `docker inspect`. A guessed project
  name starts a second stack, on fresh volumes, beside production;
- the commit of the tree in the deploy directory and the creation date of the running images;
- `rsync --dry-run -ai --delete` with the excludes of the base's own sync step: every file it would change or delete;
- free disk space, if a backup is taken.

An agent session may be refused `ssh` and `rsync` to the host. Then hand Chris the approved commands to run himself.

## Deploy

Mirror what the deploy workflow *at the production commit* does - `git show <commit>:.github/workflows/...` and, where
it exists, `.github/actions/sync-to-host/action.yml` - not master's:

1. rsync the branch into the environment's deploy directory, with the workflow's flags and excludes;
2. rebuild and recreate only the service the fix touches. At a base with `up.sh`:
   `TERPCONTROL_ENV_FILE=<env-file> COMPOSE_OPTIONS='<options>' ./up.sh server`; at an older one:
   `docker compose -p <project> --env-file <env-file> up --build -d server`. Compose also recreates a dependency
   whose definition differs from its running container - the first deploy of 2026-09-23 took `mongodb`, `rabbitmq`
   and `influxdb` along - while `./up.sh` checks the MongoDB data against its image only when `mongodb` is named or
   nothing is, so not here. `--no-deps` on the plain compose command leaves them alone. The named volumes keep the
   data either way;
3. follow `docker compose ... logs -f server`.

Chris chose this over rsyncing into a separate directory and driving the running project from there (2026-09-23):
the canonical directory and the workflow's own behaviour, the recreate scoped to `server`. He skipped the backup for
that server-only fix; how to take one on the host is in
[backup-and-restore.md](backup-and-restore.md#on-a-deploy-host).

## Afterwards

- The container was recreated (`RestartCount` 0 and a fresh `StartedAt` in `docker inspect`), its image contains the
  fix, and it survived at least one run of the code path that failed.
- The deploy directory now holds the old base. Until master is deployed again, `./up.sh` there brings up the old
  base, not master.
- Each deploy environment has a directory of its own (`deploy.yml`), so a cloud rsync leaves the firmware
  environment's sources alone; check that their `DEPLOY_PATH`s differ. Build no firmware from the patch branch
  (Chris, 2026-09-23): an old build put on a channel downgrades every device on it.
