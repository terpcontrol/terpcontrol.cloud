---
summary: Why CI, the image builds, the deploy pipeline and firmware releases work as they do, the GitHub settings behind them and their traps - read before changing .github/, a Dockerfile, up.sh or build-fw.sh, and before deploying by hand
updated: 2026-10-08
source: Chris (2026-09-23, 2026-09-30, 2026-10-01, 2026-10-04); PRs #21, #34, #61, #63, #64, #71, #73, #80, #89, #95, #104, #105, #121, #126, #142; sessions 2026-08..10; codebase cleanup (2026-10-08); GitHub repository settings read 2026-10-08
paths:
  - .github/**
  - docker-compose.yaml
  - up.sh
  - migrate-check.sh
  - build-fw.sh
  - build-garmin.sh
  - scripts/compose.sh
  - scripts/load-env.sh
  - scripts/quietly.sh
  - scripts/wait-for-healthy.sh
  - server/Dockerfile
  - webapp/Dockerfile
  - fw-buildcontainer/**
  - garmin-buildcontainer/**
  - firmware/dev-build.sh
---
# CI and release

The workflows explain themselves step by step: [`build.yml`](../../.github/workflows/build.yml) checks every pull
request into `master`; [`deploy.yml`](../../.github/workflows/deploy.yml) runs on every push to `master` and calls
[`deploy-cloud.yml`](../../.github/workflows/deploy-cloud.yml), [`deploy-firmware.yml`](../../.github/workflows/deploy-firmware.yml)
and the [`sync-to-host`](../../.github/actions/sync-to-host/action.yml) action. `up.sh`, `scripts/compose.sh`,
`scripts/load-env.sh`, `build-fw.sh`, `firmware/dev-build.sh` and the Dockerfiles carry their reasons too. This
document holds what those comments cannot: the rules behind them, the settings that live on GitHub, and the traps.

## Rules

- **One deployment per environment at a time** (Chris, 2026-09-30): every job that touches a host runs in the
  concurrency group `deploy-<environment>` and never cancels a running one. Environments still run in parallel, each
  in a checkout directory of its own.
- **No new manual approvals** (Chris, 2026-09-30). `production-cloud` keeps the one it has; everything else ships
  unattended.
- **Firmware only from `master`** (Chris, 2026-09-23): the firmware in the field is built from `master`, and a build
  from an older branch would downgrade every device. A hotfix on an older base is cloud-only - no firmware, no
  Garmin app.
- **No hotfix track in the workflows** (Chris, 2026-09-23): a redesign of the release process was discussed and
  dropped. A hotfix on an older base is deployed by hand, once - see [Deploying by hand](#deploying-by-hand).
- **Node 24 everywhere** (Chris, 2026-10-04): every `setup-node`, the images (`node:24-alpine` in the compose
  defaults and in CI's build-args), `engines` `>=24.15` in `server/`, `webapp/` and `shared-types/`, `@types/node`
  24. The webapp job once failed for two weeks on Node 20, which no machine here ran. `@types/node` 24 no longer
  declares crypto's `Cipher`/`Decipher`; use `Cipheriv`/`Decipheriv`.
- **Quiet CI logs** (Chris, 2026-10-04): remove a warning at its source and print verbose output only when a step
  fails - every line costs whoever reads the log, agents included. See [Quiet logs](#quiet-logs).
- **Default an image to the latest compatible version, not the latest one** (Chris, 2026-10-01, when `mongo` moved to
  9.0 under the stack and refused its data). See [Images](#images).

## Pull request checks

- `detect` decides which jobs run (comment there). Editing `build.yml` runs all of them, the firmware and Garmin
  builds included.
- **Required for merging** (branch protection on `master`): `server`, `docker-server`, `docker-webapp`, `webapp` and
  `firmware`, and one approving review. A job that `detect` skipped counts as passed; a new job is required only once
  it is added to the branch protection.
- **Generated contract.** `shared-types` regenerates and fails on any diff, so a commit that runs `npm run generate`
  carries everything it writes, including drift from earlier edits to doc comments in `src/`. A merge conflict in
  `v1.d.ts`, `openapi-schemas.json` or `v1-schemas/` is resolved by regenerating, never by hand. The generator
  compiles with `--newLine lf`, so its output is the same on every platform.
- **`file:`-linked `shared-types`.** Node resolves a linked package's imports from the package's own directory, so
  its dependencies (zod) must be installed wherever it is read - the images, CI's jobs and a fresh checkout
  (`npm --prefix shared-types ci --omit=dev`) - or the contract silently becomes `any`.
  `server/test/unit/contract-is-typed.spec.ts` turns that into a compile error.
- **Declare every package the code imports.** `docker-server` resolves every `require` of the compiled server inside
  the built image, because `p-limit`, reachable only through a dev dependency, passed every test and would have
  stopped the runtime image; to ask it before CI, build `server/Dockerfile` and run that step's script in the image.
  The same holds for `webapp/` (the workbox modules `sw.ts` imports are declared) and for test code (`server/`
  declares the jest packages its specs import, and specs take the driver as `mongo` from `mongoose`, never the
  undeclared `mongodb`), where no job checks it; `npx knip@5` lists unlisted imports.
- **`firmware`** compiles every variant without a server (`FW_NO_UPLOAD=1`, `FW_VERSION_ID=ci-test`) and builds the
  build container from scratch on every run ([Known gaps](#known-gaps)). A run that dies in that image build while
  PlatformIO downloads (`HTTPClientError` in `pio pkg install`, `pio platform install espressif32` failing), at a
  different layer on a re-run, is the PlatformIO registry, not the branch: check with `git diff --name-only
  origin/master...HEAD -- firmware/ fw-buildcontainer/`, re-run once, do not skip the job.
- **`garmin`** signs with a throwaway key: it proves the app compiles, nothing more. Its settings are repository-level
  because the job has no `environment:`: `GARMIN_USERNAME` and `GARMIN_PASSWORD` are secrets, while
  `GARMIN_SDK_AGREEMENT_ACCEPTED=1` is a **variable** - as a secret, the masked value `1` would blank out every `1`
  in the log. The device definitions sit in an `actions/cache` entry keyed on `garmin/manifest.xml`; only a product
  the cache lacks needs the Garmin login.

### Quiet logs

The means are commented where they are: `scripts/quietly.sh` and `fw-buildcontainer/quietly` print a step's output
only when it fails, `firmware/dev-build.sh` a green build's warnings and one line per image. npm's footers are
switched off by flags (`--no-audit --no-fund`), not by `npm_config_*` in `env:`, which GitHub prints in every step's
header. A full green run went from 53,301 log lines to about 5,100; most of the rest is `setup-buildx-action` and
`build-push-action` in the docker jobs, which only calling buildx directly, cache wired by hand, would silence.

## Images

- **Base images are compose's choice.** `server/Dockerfile` and `webapp/Dockerfile` take them as build arguments
  without defaults. CI's docker jobs call `build-push-action` directly and pass the same values as `build-args`: keep
  them in step with the compose defaults (`DOCKER_NODE_SERVER_IMAGE`; `DOCKER_NODE_BUILD_IMAGE`, which compose hands
  to the webapp as `DOCKER_NODE_WEBAPP_IMAGE`; `DOCKER_NGINX_IMAGE`). A missing one fails with `base name should not
  be blank`.
- **The server image ships only what runs**: production dependencies and `dist/`, so `npm audit --omit=dev` checks
  exactly what ships and nothing is compiled when a container starts (details in the Dockerfile).
- **Install scripts** are decided in `allowScripts` (`server/package.json`, written with `npm install-scripts`): the
  npm of Node 24 (11.19) warns about every install script the field does not cover, and npm 12 runs none of them.
  Allowed: `bcrypt` (finds its prebuilt binary), `mongodb-memory-server` (fetches the integration suite's `mongod`;
  the image turns it off with `MONGOMS_DISABLE_POSTINSTALL`). Denied: `@scarf/scarf` (swagger-ui-dist's install
  analytics), `nodemon` (asks for donations), `fsevents` in `server/` and `webapp/` (macOS only, nothing to run).
  Approvals are pinned to the version reviewed, so an update asks again; denials are not pinned.
- **Tags.** MongoDB is pinned to a release (`mongo:9.0`; the comment in `docker-compose.yaml` and [data](data.md)
  say how to raise it). Still on moving tags: `influxdb` and `mongo-express` (untagged, so `latest`) and
  `rabbitmq:management`; `node:24-alpine` and `nginx:1-alpine` move within their major only. `node:24-alpine` has
  no 32-bit ARM build ([RASPBERRY-PI.md](../../RASPBERRY-PI.md)).

## The deploy pipeline

- **Merging is releasing.** Every push to `master` - a docs-only one included - syncs staging and recreates every
  container there (`./up.sh` forces it), and does the same on production once a reviewer approves. Keep a pull
  request a draft until `master` may ship it. Staging (the dev stack) is deployed from `master`, so a fix shows there
  only after its merge.
- **Tracks** (header of `deploy.yml`): cloud `staging-cloud` -> `production-cloud`, firmware `staging-firmware` ->
  `production-firmware`, and `garmin`. Only `production-cloud` waits for a reviewer. While it waits it holds its
  environment's lock: later `production-cloud` deploys queue behind it, GitHub keeps only the newest waiting one, and
  it gives up on an unapproved deployment after 30 days.
- **Where the settings live.** Each environment sets `DEPLOY_PATH` (a directory of its own) and
  `TERPCONTROL_ENV_FILE` - the staging environments share one env file, the production ones and `garmin` another, so
  a firmware release builds against and uploads to the API of its own track's stack. `DEPLOY_HOST`, `DEPLOY_USER`
  (variables) and `SSH_PRIVATE_KEY` (secret) come from the environment, or from the repository where the environment
  defines none: an environment value shadows the repository one. `COMPOSE_OPTIONS` is optional and set nowhere; the
  compose project comes from `DOCKER_COMPOSE_NAME` in the env file, else from the directory's name
  (`scripts/compose.sh`).
- **Never define `DEPLOY_PATH`, `TERPCONTROL_ENV_FILE` or `COMPOSE_OPTIONS` at repository level.** They select which
  checkout and which stack a job acts on; an environment that lacks one would inherit it and act on another track's
  stack. `COMPOSE_OPTIONS` goes before the subcommand, so it can hold `-f`, `-p` or `--profile`, never
  a flag of `up` such as `--scale`.
- **Start Deploy by hand only on `master`.** A manual run ships the commit it is started on, like a push: staging
  gets that branch, and its firmware - every variant unless `hardwares` names fewer - goes onto staging's alpha
  channel and up to production ([Rules](#rules): firmware only from `master`).
- **The sync deletes.** `sync-to-host` runs `rsync --delete`; besides build output (`node_modules/`, `.pio/`,
  `dist/`, `build/`) it spares only `.env` and `.env.*`. Anything else in `DEPLOY_PATH` that is not in the repository
  is gone after the next deploy: a `./backup.sh` dump (written to the current directory), the MQTTS CA key
  (`./mqtts-ca.key` by default), `garmin/bin/`. Keep env files, backups and keys outside the deploy path, as the
  environments' env files are ([backups](../runbooks/backup-and-restore.md#on-a-deploy-host),
  [CA key](../runbooks/mqtts-certificates.md#on-a-deploy-host)). The sync changes nothing that runs: after a deploy
  that failed past it, the deploy path holds the new commit while the old containers keep running, and `./up.sh`
  there brings up the new commit.
- **A cloud deploy** is `./up.sh` and then `scripts/wait-for-healthy.sh server 1800` (both commented in
  `deploy-cloud.yml`). `up.sh` stops before recreating anything when the MongoDB data does not fit the image; then
  `./upgrade-mongodb.sh` has to run on that host first ([runbook](../runbooks/mongodb-upgrade.md)). A boot
  migration the server refuses shows as a deploy that waited and failed; `./migrate-check.sh` asks the same question
  beforehand, without writing.
- **The Garmin app** is built once per run on the `garmin` environment's host, for the developer key in its env file
  (comment in `deploy.yml`); the `.iq` stays on the run for 90 days for the store upload by hand ([garmin](garmin.md)).

## Firmware releases

- **Version.** `deploy.yml` names a build `<short sha>-<slug of the commit subject>` (or `<sha>-<description>` from a
  manual run), at most 63 characters of `[A-Za-z0-9._-]`. `fgcli.py create-fw` registers the build under that
  version, and the id the server gives it is compiled in (`FW_VERSION_ID`, `firmware/pioenv.py`). Devices report
  that id - in `hardware-info` and in the fetch message on connect - so the version string only names the record.
- **What `build-fw.sh` does with a build** (`firmware/dev-build.sh`):

  | Set | Result |
  | --- | --- |
  | `FW_NO_UPLOAD=1 FW_VERSION_ID=<any>` | compiles only, no server needed (CI, `AGENTS.md`) |
  | `FW_UPLOAD_VERSION` | registers and uploads; no channel moves (`production-firmware`) |
  | `FW_UPLOAD_VERSION` and `FW_SET_ALPHA=1` | ... and puts it on the alpha channel of its class (`staging-firmware`) |
  | neither | registers version `0.0.0`, uploads and puts it on **stable and beta** (`rollout-id`) |

  The last row is the self-hoster's `./build-fw.sh` from the README. To do from a developer machine what staging
  does, set both: `FW_UPLOAD_VERSION=<name> FW_SET_ALPHA=1 ./build-fw.sh fridge`; `FW_SET_ALPHA` alone puts the build
  on alpha, beta and stable.
- **Which variants** a push builds is decided in `detect` (changes since the last push run whose production firmware
  release went through). A manual run takes `hardwares` (`none` skips firmware), `description`, `skip_deploy` and
  `build_garmin`.
- **The build scripts are release paths.** `build-fw.sh` and `fw-buildcontainer/` count as shared firmware paths and
  `build-garmin.sh` as a Garmin path: touching one, even with identical output, releases every firmware variant (or
  builds a new Garmin app) on merge, so change them only in a firmware or Garmin pull request. The helpers they source
  (`scripts/load-env.sh`, `scripts/quietly.sh`) run the pull request's `firmware` and `garmin` jobs and release
  nothing.
- **`production-firmware` uploads to the production server as it stands**, which can be older than the commit being
  released (production moves only when `production-cloud` is approved). So `fw-buildcontainer/cli.py` has to speak
  the API of the server before it as well; its fallback to the pre-`/v1` routes goes once no deployed server is
  older than `/v1`. The build container is rebuilt on every release, so a change to it ships with the next one.
- **Upload size.** Each image goes up as base64 inside one JSON body (a full 2 MiB OTA slot is about 2.7 MiB).
  `PUT /v1/admin/firmwares/{id}/binaries/{name}` accepts up to 16 MiB, every other route 1 MiB; a reverse proxy in
  front of the API has to let that through ([Reverse proxy](#reverse-proxy-in-front-of-the-api)). The web app's admin
  upload uses the same route, and `server/test/specs/http-contract.spec.ts` holds both limits.
- **The build container** is `debian:11.7-slim` on archive.debian.org since bullseye's end of life
  (`fw-buildcontainer/Dockerfile` says why). Moving it to a supported Debian changes the compiler and Python under
  ESP-IDF 4.4, so it waits for a change of its own. Such an upstream break shows up without any change here: in CI
  only on a pull request that touches the firmware paths, otherwise at the next firmware release.
- **On real hardware** a firmware change is verified before its merge with the `/firmware-check` skill
  ([testing with real devices](testing-real-devices-and-data.md#firmware-on-the-development-devices)). How channels
  and rollouts carry a build to the devices: [firmware](firmware.md#ota-and-update-channels).

## Deploying by hand

Only for a hotfix on an older base (see [Rules](#rules)); everything else goes through `deploy.yml`. The procedure -
patch branch, Chris's approval of the exact commands, read-only inspection, a deploy that mirrors the production
commit's own workflow, the checks afterwards - and the traps of a compose command run by hand (a guessed project name
starts a second stack, dependencies are recreated along) are the runbook
[A hotfix for production on an older base](../runbooks/production-hotfix.md).

## Reverse proxy in front of the API

Not part of this repository; `.env.sample` names both needs (at `AUTOMATION_TOKEN` and `TERPCAM_RELAY_URL`).

- **Firmware uploads**: `client_max_body_size 16m` in nginx, to match the server. nginx refuses more than 1 MB by
  default with a 413 of its own, before the server sees the request.
- **The Terp Cam relay** on `/terpcam/relay` is an HTTP upgrade, which nginx does not pass on by itself:
  `proxy_http_version 1.1`, `proxy_set_header Upgrade $http_upgrade`, `Connection` from a `map` of `$http_upgrade`
  (default `upgrade`, empty `close`), and `proxy_buffering off` for that location - with the path prefix, if the API
  sits under one. The default timeouts suffice: the device hangs up after 30 s without traffic and ends a relay after
  two minutes. HTTP/2 on the same listener does not interfere, the device speaks HTTP/1.1. A CDN that cuts requests
  shorter than two minutes cuts relays.

## Known gaps

- **The build containers never hit the GitHub Actions cache.** `build-fw.sh` and `build-garmin.sh` run `docker
  buildx build --cache-from/--cache-to type=gha` from a plain `run:` step, which does not see
  `ACTIONS_RUNTIME_TOKEN` and `ACTIONS_RESULTS_URL`, so buildx silently drops the cache and both images are built
  from scratch on every run. A `crazy-max/ghaction-github-runtime` step would expose them, but one layer of the
  firmware image is about 4 GB against the repository's 10 GB cache quota, so `mode=max` may evict the other caches.
  Pinning and caching the PlatformIO packages inside the image would also end the dependence on a live registry.
- Images on moving tags ([Images](#images)); the end-of-life Debian under the firmware build container (above).
