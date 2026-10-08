---
summary: How the software is tested day to day and what bites - the server and webapp suites, checks that lie, flakes and their causes, clock-dependent tests, the simulator beyond CLAUDE.md, own test stacks, Docker trouble, browser checks, testing on an older base
updated: 2026-10-08
source: Chris (instructions 2026-09-16..2026-10-05, dated inline); agents' findings in sessions and PRs 2026-06..2026-10 (#48-#144); the rewrite handover's rules (2026-09); codebase cleanup (2026-10-08); checked against the code 2026-10-08
paths:
  - server/test/**
  - server/jest.*.config.js
  - webapp/test/**
  - webapp/vitest*.config.ts
  - simulate-device.sh
  - scripts/simulate-device.mjs
---
# Testing

First-time set-up and the simulator's commands are in [CLAUDE.md](../../CLAUDE.md#launching-the-stack-locally);
rollouts and the checks before a commit in [AGENTS.md](../../AGENTS.md); the server's suites in
[server/test/README.md](../../server/test/README.md) and the legacy fixture in
[its README](../../server/test/fixtures/README.md); what CI runs in [ci-and-release.md](ci-and-release.md). Firmware on
hardware, the development devices and copies of production data are in
[testing-real-devices-and-data.md](testing-real-devices-and-data.md). This document holds what those do not say.

## Rules
- **A green run is silent.** A passing test that - or whose code or a library - writes to the console is hiding a
  fault: fix the complaint, never filter it. Both suites print such output on purpose.
- **A regression test counts once it has failed with the fix reverted.** The first test for a pagination leak used
  an owner as caller and passed without the fix: only a member's visibility filter has the `$or` that got clobbered.
- **An access test asserts absence too**: what a member, a share-link holder or the public must not reach is checked,
  not only what they must ([server](server.md#share-links-and-public-pages)).
- **A zero needs a positive control.** "No diary lines since the fix" means something only once the pipeline has
  shown it delivers - reboot a smart plug and its `message-device-booted` line arrives within about 5 s.
- **Each check is its own command**, read before the next ([AGENTS.md](../../AGENTS.md#before-committing)).
  `npm run lint && npm run test:unit` stops at the first prettier error and hides the tests from every agent working
  in parallel; fix lint debt at once, in its own commit. CI fails a job when `npm run lint:fix` changes a file.
- **Fixtures are valid and fixed.** Image fixtures are well-formed files (sharp 0.35 refuses a damaged PNG that 0.34
  read: `422 not_a_picture`). A tamper test makes sure its replacement differs from the original (a Telegram link
  "forged" by setting its last character to `x` was the real one about one minute in 64). Times are pinned
  ([Clocks](#clocks)).
- **Probes go through the API.** A row written past the schema makes states the migration never does (a device
  without its `firmware` object made `GET /v1/devices` answer 500).

## Server suites
- `npm test` in `server/` runs the unit suite, then the integration suite, with everything they need started for
  them; CI runs both against `dist/` (`HARNESS_BUILT=1 npm test` after `npm run build`).
- **The integration suite (about four minutes) wants the machine to itself.** A run beside five agents driving browsers
  and compose stacks failed 19 tests that passed on three quiet re-runs. Re-run on a quiet machine before diagnosing.
  Several worktrees may still run `npm test` at once: the harness takes free ports and keeps its state in the
  worktree's own `test/.tmp`.
- It is black-box and has no path aliases: relative imports, no application module (the migration step list pulls in
  the whole app, so `migrations.spec.ts` counts the files in `src/migrations/steps/`).
- A new controller tag needs its description in `TAGS` (`server/src/openapi.ts`), or `openapi.spec.ts` lists every
  new operation as ungrouped.
- `tsconfig.json` type-checks `src/` only. For the unit specs and fixtures:
  `./node_modules/.bin/tsc --noEmit -p tsconfig.unit.json --skipLibCheck --pretty false` (without `--skipLibCheck`
  mongodb-memory-server's own declarations report a missing `semver` type).
- The integration suite fakes InfluxDB and SMTP, so a live probe against a stack still finds what it cannot
  ([rebuild its server first](#own-test-stacks)).

## Webapp suites
- `npm test` (vitest, jsdom) needs only the checkout. `npm run test:live` runs `test/live/` against a running stack;
  CI does not run it.
- **`webapp/.env.local` breaks `test/me.test.tsx`**, which expects the fallback API `http://localhost:5081`: vitest
  reads the file, and `npm start` writes it from `API_URL_EXTERNAL`. Run `VITE_API_URL=http://localhost:5081 npm test`
  (the environment wins over the file) or delete it. A hand-written `.env.local` survives `npm start` since #133.
- `shared-types/` needs its own `node_modules` (`npm --prefix shared-types ci --omit=dev`), or the contract's values
  type as `any` and `tsc` reports spurious errors in `test/schemes.test.ts`.
- Thousands of React `act()` warnings mean a file's own `afterEach` ran before Testing Library's cleanup; the config
  runs hooks in registration order (`sequence.hooks: 'list'` in `webapp/vitest.config.ts`) for that.

## Checks that lie
- **A fresh worktree has no `node_modules`**, and `npx tsc ... | grep -c "error TS"` prints 0 there: npx fetches the
  unrelated `tsc` package, which only says "This is not the tsc command you are looking for". `npm ci` in
  `shared-types/`, `server/` and `webapp/` first, or call `./node_modules/.bin/tsc`, which fails when it is missing.
- **A type check that looks inexplicably wrong**: look at `server/node_modules/@fg2/shared-types` and its webapp twin,
  both links to `../../../shared-types`. An agent's scratch copy once repointed one mid-run;
  `ln -sfn ../../../shared-types shared-types` inside `node_modules/@fg2/` puts it back.
- **"Cannot use import statement outside a module" in a file that compiles** means the two server suites share a jest
  cache again. Each config has its own `cacheDirectory`; keep it so.

## Flakes we have had
- *A spec file fails with "didn't exit with signal SIGINT within 10 seconds" while every test passed:* mongod's clean
  shutdown syncs every table, on macOS each sync is a full drive flush, and a dozen mongods stopping together outlast
  mongodb-memory-server's 10 s. Stop spec mongods with `stopMongod` (`server/test/unit/support/mongod.ts`).
- *Camera specs time out after other specs added cameras:* unreachable test cameras held the server's ffmpeg slots
  (a Mac's ffmpeg waits 75 s per connect, and jest runs a previously failed spec first). The ffmpeg shim answers a
  stream on another machine as unreachable at once, and each spec's cameras are removed when it ends.
- *`write ECONNRESET` in a body-limit test:* Fastify refuses on `Content-Length` and closes while the client still
  writes. Announce the length, write a few bytes, read the 413 (`answerToABodyOf` in `http-contract.spec.ts`).

## Clocks
- A test whose subject meets a day boundary, an age, a "since" or day and night pins the clock:
  `vi.useFakeTimers({ toFake: ['Date'] })` plus `vi.setSystemTime(<midday Europe/Berlin>)`, real timers restored
  afterwards; a fixture's live answer says `transition: null` unless the test is about one. Server code takes `now`
  as an argument (`v1-home.spec` was red 22:00-23:00 UTC because `HomeService.read` passed none to `readingsOf`).
- Such tests were red between 00:00 and 02:20 in Berlin, for good once a fixed fixture date had aged past a limit, in
  early January, and in the quarter hour before a fixture fridge's 18:00 UTC light-off. To hunt them, run the whole
  suite with the process clock moved to every quarter hour of a day in Europe/Berlin, to weeks and months ahead and to
  New Year's night, and the touched files under `TZ=UTC`, `TZ=America/Los_Angeles` and `TZ=Asia/Tokyo`.

## The simulator, beyond CLAUDE.md
- It runs from a bare checkout on Node 24 - built-ins plus schema-free `shared-types/v1-schemas/` modules that import
  nothing but each other (`day-night.js` reads `configuration-fields.js`) - because a dev tool that needs an install
  first is one nobody runs (#78). Keep it that way.
- It follows the firmware: day and night from the shared day-night module on the UTC clock, each type's work modes
  and ramps, the AIR's speed in percent, the humidifier's hysteresis; only fridge and controller drive smart sockets.
  Noise is seeded by the device id, so charts compare between runs. Restart running `run`s after pulling simulator
  changes; history an older simulator wrote stays as it was.
- The emulated camera sends every fragment at once and ignores acks, so fragment loss on a slow uplink needs the real
  camera. Only the device that is in `run` answers a relay.
- `-t <type>` goes on every command for anything but a controller. `run --fault ext-sensor-fail` or
  `ext-sensor-deviate=<s>` needs `-t fridge`; the fault is reported at most every 15 minutes, as the firmware does,
  from times in process memory (the simulated reboot keeps them, restarting the script clears them).
- `setup` claims into the `AGENT_TESTING_*` account and makes a space named after the last six characters of the id,
  where the app's claim flow names it ("Kühlschrank 1"). `setup --no-claim` leaves the device to a claim in the app;
  `-d <id> claim` claims into the env file's account.
- More accounts: the wrapper builds `SIM_USER` from `AGENT_TESTING_USERNAME` and ignores one in the environment. Give
  each account a copy of the env file with its own `AGENT_TESTING_*` and pass it as `TERPCONTROL_ENV_FILE`.
- `demo-seed` makes two tents (one with a camera) and a fridge with 21 days at 30-minute steps, settings and alarm
  rules, the grows "Spring run" and "Balcony tomatoes" (in a balcony without a device) with a backdated diary, and a
  second account when run as admin. It does not share the tent with that account yet.
- Alarms on a seeded stack: the first tent's seeded maintenance line holds its alarms for 20 minutes plus
  `MAINTENANCE_SETTLE_SECONDS` (10); a rule trips only after its `forSeconds` out of band (demo-seed: 900), so pin the
  value with `run --set` rather than one `send --set`; once fired it is quiet for its `cooldownSeconds` (1800).
- Stop `run` for the other states: stale after 2 minutes (amber, values dimmed), offline after 10 (`VALUE_AGE`).
- Vertical "combs" in a chart are two backfills on different grids in one window (demo-seed's plus a `history`), not
  the app. Delete the device's points (`influx delete --predicate '_measurement="status" AND device_id="<id>"'` with
  the stack's token, org, bucket and a time range) and seed one history.
- After a stack's database was emptied, the broker refuses the simulated devices registered before: they no longer
  exist. Register new ones.

## Own test stacks
- Work that needs a running server gets a stack of its own on other ports, driven with simulated devices (Chris,
  2026-09-16): its own `.env` with its own `DOCKER_COMPOSE_NAME` (plain `docker compose` reads `COMPOSE_PROJECT_NAME`
  instead) and every `*_PORT_EXTERNAL` moved. When the work is done - for one left up for review, after the merge -
  remove it with `./down.sh --volumes` from its own directory: the scripts act on the project their `.env` names.
- **After a server or contract change, rebuild the stack's server** (`docker compose up --build -d server`, about a
  minute) before a live probe, a screenshot or an agent drives the app. The image bakes the source in: a container
  from before the change answers 404 on every new route, and screens read fields it has never heard of.
- `AGENT_TESTING_*` is the admin and sees every device, camera and account by design. Ownership and access tests need
  ordinary accounts made through the API (`POST /v1/users`; no activation with `REQUIRE_ACTIVATION=false`); deleting
  them afterwards (`DELETE /v1/admin/users/{id}`) exercises the deletion cascade too.
- Rate limits count per client address and route, per minute, in server memory: sign-in 10, sign-up 5, automation 20.
  All agents on a machine share them, and one that spends a budget locks the others out for up to a minute. A user
  token lives 5 minutes: a helper signs in once and renews in time (the rewrite's kept its token 240 s); a monitor
  reads MongoDB or the device's serial log rather than signing in per poll.
- The app's first sign-in adopts the browser's time zone (`ZoneAdoption`) unless the account has chosen one: set zone
  and language through the API before a walk, or the walk's browser decides them.
- Agents littering a shared stack (one round left 39 spaces, 47 devices and 9 grows): brief them to use
  `setup --no-claim`, to name what they make after their task and to report every id. Clean up with
  `./down.sh --volumes`, re-seed and re-run the scenario, not piecemeal.

## When Docker misbehaves
- **Disk:** builds fill the Docker VM's disk, not the Mac's. MongoDB then crash-loops (WiredTiger "No space left on
  device"; it will not start below 500 MB free). `docker builder prune -af` freed ~55 GB once; `docker image prune -a`
  would also delete other projects' images.
- **Memory:** one VM of about 8 GB serves every stack. A restore's index build got mongod killed twice beside four
  stacks and orphaned Playwright browsers (~700 MB each). Before a restore or migration, stop the other stacks and
  close leftover browsers by their own PID - a broad `pkill` kills other agents' browsers. Close browsers in `finally`.
- **Pulls hang** when `docker-credential-desktop` waits on a keychain prompt; `DOCKER_CONFIG` pointing at a directory
  with a credential-free `config.json` gets builds going.
- **RabbitMQ crash-loops with `failed_to_parse_configuration_file`:** its entrypoint edits the config inside the
  container (with MQTTS it appends the TLS block on every start), so a restart keeps whatever the file has become.
  Recreate it (`./up.sh rabbitmq`). `docker compose restart rabbitmq` restarts the broker alone since the server's
  `links:` went (#95) - the way to watch the server reconnect.

## In the browser
- Playwright with the installed Chromium ([CLAUDE.md](../../CLAUDE.md#in-a-sandboxed-agent-session)). Its bundled
  Chromium plays no MP4, neither H.264 nor the H.265 the timelapses are encoded in: test playback logic with a VP9
  stand-in. `npm run start:public` serves the dev server to other machines - a phone, given an API address it reaches.
- A UI change is checked on the real stack in every state it has - live, stale, offline, device only, diary only,
  several places - light and dark, phone first (390x844, also 360 and 320 px), then desktop (1440 px).
- Not defects: the service worker never registers in the Claude desktop app's built-in browser pane ("unknown error
  when fetching the script", on master too) - check it in another browser; `GET /v1/devices/{id}/plan` answers 404 for
  every device without a plan ([webapp](webapp.md#api-client-and-reads)).
- The rewrite was walked with persona accounts made the way a grower makes them (sign-up through `POST /v1/users`,
  zone and language before the claim, the place renamed as the claim flow does, grows through the app's routes): one
  fridge without camera or diary (the main persona), a tent with leaf temperature and lux, a fridge with a Terp Cam,
  a tent set up today, an offline fridge, two places, a diary with grow and tasks, a diary without device, an RTSP
  camera alone, running and finished grows, two walk accounts agents may change (restored afterwards), and the admin.
  Agents who built nothing walk them; their credentials go into a file outside the repository.
- Change the browser, not the server: `page.clock.install()` skews the browser clock (ages come from the server's);
  `timezoneId` far from the account's zone (Asia/Tokyo, Pacific/Auckland - a +2 h zone flips a date only for instants
  between 22:00 and 24:00 UTC); `context.route('**/v1/**', ...)` aborts, holds or answers 500 for failure and loading
  states; a GET answer rewritten on its way in reaches an access branch (`youMay: "log"`). A check that must write
  nothing aborts every non-GET except `POST /v1/sessions` and `/v1/sessions/refresh`.
- Full-page shots that resize the viewport to the page height leave fixed sheets floating: shoot an open sheet at the
  phone viewport. Guard clicks on controls that may be disabled with `isEnabled()`, or `click` waits out its timeout.
- The pre-rewrite Angular app (before #104) signs in through `ion-input` and `ion-button`: fill the inputs inside the
  `ion-input` elements and click the first `.login-actions ion-button`; Enter does nothing.

## On an older base
For a hotfix on a branch from before the NestJS move (#87, 2026-09-10; the procedure is the
[hotfix runbook](../runbooks/production-hotfix.md)): its config loads `.env.${NODE_ENV}.local`, and without one
`LOG_DIR` is undefined and every suite importing `src/app.ts` dies in the logger. Create a gitignored
`server/.env.test.local` (`NODE_ENV=test`, `PORT`, `LOG_DIR`, `LOG_FORMAT`, `SECRET_KEY`, `ORIGIN`, `CREDENTIALS`,
`DB_HOST`, `DB_PORT`, `DB_DATABASE`, local dummy values) and run with `NODE_ENV=test` and MongoDB up
(`docker compose up -d mongodb`). CI there only built: `users.test.ts` and `auth.test.ts` do not compile and
`index.test.ts` expects 200 on `/`, whatever the change. Before #78 there is no simulator, and the camera is the RTSP
puller: give a local device `cloudSettings.rtspStream` on a synthetic RTSP source, seed backdated stills into the
database (inline `data` and GridFS) and wait for the compression pass 60 s after the server starts. A database the
current server has migrated cannot serve that one ([why](testing-real-devices-and-data.md#copies-of-production-data)).
