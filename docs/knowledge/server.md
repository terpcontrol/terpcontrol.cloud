---
summary: How the server is put together and what every route obeys - process and boot, configuration and env variables, the /v1 contract and status codes, sessions and accounts, demo mode, share links, the broker side of MQTT, security decisions
updated: 2026-10-08
source: Chris (PR reviews and sessions 2025-10..2026-10); app-rewrite sessions and their critics 2026-09..10; PRs #27-#141; commit history; codebase cleanup (2026-10-08); checked against the code on 2026-10-08
paths:
  - server/**
  - shared-types/**
  - docker-compose.yaml
  - .env.sample
  - rabbitmq/**
---
# Server

NestJS 12 on Fastify, with Mongoose, the InfluxDB client and mqtt.js; how it was moved there and what the HTTP layer
keeps from Express is [ADR 0004](../adr/0004-server-on-nestjs-and-fastify.md). Model, access rules and routes are
decided in [ADR 0001](../adr/0001-app-rewrite-data-model.md); what a device sends and receives is
[the device protocol](../device-protocol.md). What the engines do - alarms and notifications, device settings and
plans, read models - is in [server-engines.md](server-engines.md); storage, exports, cleanup and retention in
[data.md](data.md), migrations and backups in [data-operations.md](data-operations.md); cameras in
[terp-cam.md](terp-cam.md). The code comments are thorough: this says where things are and which rules span files.

## Map
- `server/src/main.ts` boots, `app.module.ts` lists the modules in order of dependence. `modules/device-protocol/` is
  the frozen boundary to the hardware, `modules/v1/*` are the API slices, `common/v1/` is what they share
  (`access.service.ts`, `range.ts`, `entry-writer.service.ts` - the only writer of diary entries - `problem.ts`).
- A slice that needs another names a port (an injection token, injected `@Optional()`) and `wiring.module.ts` binds
  it; there is no `forwardRef`, keep it so. Nest says nothing when this goes wrong: an unbound port silently does
  nothing (an unbound `ALARM_ROUTING` once dropped every routed alarm) and a provider cycle boots and never listens.
  After adding one, check the binding and that the server really listens.
- Outside `/v1`: `/device/*` and `/auth/v0.0.1/device/*`, `/mqttauth/:secret/*`, `/healthz`, `/readyz`,
  `/telegram/:secret`, `/terpcam/relay` (an HTTP upgrade), `/g/:slug` and `/@:handle` (Open Graph shells),
  `/api-docs` with `/swagger.json`.

## Process
- One Node process (`node dist/main.js`), one compose `server` service. The in-memory rate limits, the per-device
  locks of the ingest and the alarm engine and the tunnel table rely on that; a second replica or a worker cluster
  needs shared state first.
- Boot: `NestFactory.create`, the migrations, `listen`. Everything that works on its own starts in `onModuleInit`,
  which `listen` triggers, so a migration sees a quiet database. Also at boot: the environment is validated
  (`config/validate-environment.ts` names every missing variable, then exit 1); the five hardware device classes -
  fridge, fan, light, plug, controller - are seeded (a type without one is refused at `POST /device/register`, the
  retired dryer included); the `ADMINUSER_*` account is created, or made admin and active **with its password reset
  to the configured one** - a password changed in the app is lost on the next restart.
- `/readyz` answers 200 once the admin account exists; the compose health check and `scripts/wait-for-healthy.sh`
  read it. Background loops are kept out of it on purpose - a lagging loop must not take a working API out of
  rotation - and report on `GET /v1/admin/stats` (`retention`, `alarmWatch`).
- A throw nobody catches, an unhandled rejection included, ends the process on purpose (`main.ts`) and
  `restart: always` brings it back. Work without a caller - timers, MQTT and stream callbacks - runs through
  `BackgroundWork` or `logIfItFails` (`common/background-work.ts`), which log a failure as `<name> failed: <stack>`.
  A periodic job is `repeat` (fixed ticks, a tick skipped while the last pass still runs) or `loop` (the next pass
  armed only once one has finished, its delay computed per pass if need be), never a timer it re-arms itself in a
  `finally`; neither arms anything while the server stops. A `void` promise fired from a timer once crash-looped a
  server.
- Loops: MQTT connect (retry 5 s), plan engine 20 s, alarm health 60 s, schedule clocks 60 s, firmware rollout 10 s,
  camera poller (5 s between passes), export builder 5 min, timelapses, task announcer, weekly recap and the resume of
  unfinished account deletions hourly, cleanup and climate retention daily.
- SIGTERM: logged at both ends around `app.close()`; the tunnel tells every device it is closing while the broker is
  still connected (`beforeApplicationShutdown`); then the signal is re-raised.
- Logs: console, plus daily files under `LOG_DIR` (`debug/`, `error/`, 30 days). `LOG_DIR` is an image constant, like
  the container ports: `server/Dockerfile` sets it and creates the directory for its user; compose neither passes it
  nor gives it a volume, so the files go with the container. `SERVER_LOG_FORMAT=disabled` drops the access lines;
  `/v1` refusals log 5xx as error, 404 as debug, other 4xx as warn.

## Configuration
- Defaults, also values derived from other variables, live in `docker-compose.yaml`; the server reads what compose
  passes (Chris, 2026-09-09 and 2026-09-30: "not the first time this happened"; rule in `AGENTS.md`). Example:
  `TERPCAM_RELAY_URL: ${TERPCAM_RELAY_URL-${API_URL_EXTERNAL}/terpcam/relay}` - `-` keeps an empty value empty,
  which turns the relay off. Code falls back only where the value is also read outside compose, and says so
  (`MIGRATION_LOCALE` for `npm run migrate`, `RETENTION_CLIMATE_DAYS`).
- Settings are explained in `.env.sample`, in their service's section, not in compose comments. Container ports are
  constants; only the published port is a setting (Chris, 2026-09-29). A `*_PORT_EXTERNAL` may carry a bind address,
  and what need not be reachable from outside keeps the localhost bind `.env.sample` gives it. The MQTT ports stay
  bare: they are compiled into the firmware.
- Required: `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `SECRET_KEY` (from `TOKEN_SECRET_KEY`), `LOG_DIR`, `ADMINUSER_*`,
  `API_URL_EXTERNAL` - the only source of absolute URLs; the old `Host`-header fallback let a request put its own
  address into every public diary's `og:image`.
- The rest is off until set (`.env.sample`). `PREMIUM_*` unset gates nothing, so a local stack shows the enforced
  Premium screens only with `PREMIUM_ENFORCED`, `PREMIUM_EXTEND_URL` and `PREMIUM_PRICE_LABEL` set.
  `AUTOMATION_TOKEN` buys a 5-minute token at `POST /v1/sessions/automation` for an administrator without an
  account or session row - enough for `/v1/admin`, nothing that needs a person (the firmware build CLI,
  `fw-buildcontainer/cli.py`).
- Behind a reverse proxy the server trusts exactly one hop (`trustProxy`, `main.ts`), so the proxy must send
  `X-Forwarded-For` and `X-Forwarded-Proto`, or all clients share one rate-limit budget. What the camera relay and
  firmware uploads need of the proxy: `.env.sample` and [terp-cam.md](terp-cam.md).

## The /v1 contract
- Wire shapes are zod schemas in `shared-types/src/v1/`; `npm run generate` writes `v1.d.ts`, `v1-schemas/` and
  `openapi-schemas.json`, all committed, and CI fails on a stale generation. Why two entry points, and why server and
  shared-types must be on one zod version: the header of `shared-types/scripts/generate.mjs`. A rule both ends apply
  (`value-age.ts`, `alert-routing.ts`, `day-night.ts`, `plan-clock.ts`, `steering.ts`, ...) lives beside the schemas
  in a schema-free module, which the web app and the simulator load at runtime - how such a module may import:
  [webapp.md](webapp.md#the-shared-contract).
- Routes declare `@V1Answer(schema, { status })`, validate with `@V1Body`/`@V1Query` and need a tag with a
  description in `TAGS` (`src/openapi.ts`); `test/specs/openapi.spec.ts` holds real answers, bodies and refusals to
  `/swagger.json`.
- Secrets are not in the contract, and their fields are `select: false` ([data.md](data.md)). Answers go through
  serialisers, never as a stored row - sign-up once answered the bcrypt hash and the activation code.
- Bodies drop unknown fields. Query flags are `z.enum(['true','false'])` read as `=== 'true'` (`z.coerce.boolean()`
  reads `'false'` as true); instants use `instantQuery()` (an untyped `'1'` became 2001-01-01); a list
  (`metrics=a&metrics=b`) is `repeated(item)` (`common/v1/validation.ts`), because one value arrives as a string and
  several as an array; a sparse enum-keyed map is `z.partialRecord`, because zod 4's `z.record` over an enum demands
  every key.
- Every access decision is `access(ctx, subject, need)` (`AccessService`); never hand-roll an ownership check. Its
  `Grant` also says what the reader may see: the window (`clampRange`), `redacted`, `includeCameras`. A space answers
  `youMay` (`own` · `manage` · `log` · `view`) per reader, from `SpacesService.mayIn`, which
  `test/unit/v1-spaces.spec.ts` holds to `access()`; clients draw from it rather than re-derive a role. The one
  exception are rows in no space and of no grow (saved charts, feeding schemes): `ownRows` for a list (personal, even
  for an administrator) and `requireOwned` for one named row (`common/v1/owned-rows.ts`). A route about the caller's
  own account takes its id from `accountOf` (`modules/v1/caller.ts`), which answers a demo session 403 `no_account`.
- 401 means only "no valid session": the webapp refreshes once and replays on it, so an authorization failure must
  never answer 401. What the caller may not see, what never existed and what is somebody else's answer the same 404
  (`AccessService.require`), also when a list filter names it (except `tasks?assigneeId`); a refused write on
  something visible is 403, and so is a non-admin on `/v1/admin`.
- One global filter answers every throw, `ApiExceptionFilter` (`common/exception.filter.ts`): a problem document
  under `/v1`, `{ message }` beside it, plain text for a `PlainTextException` (the broker's auth backend reads words).
  A Nest `HttpException` under `/v1` gets its status's generic code (`not_found`, `forbidden`); a refusal a client
  must tell apart is thrown with the helpers of `common/v1/problem.ts`. A second global filter would never be asked.
- Every cursor-paged list is read with `findPage` and answered with `mapPage` (`common/v1/pages.ts`), never a
  hand-built query: it puts visibility, filters and cursor under one `$and`, because two `$or` in one object overwrite
  each other ([data.md](data.md#mongodb)). A list built in memory cuts its page with `pageOf`. A list widens as
  `access()` does (a room membership covers the spaces in it: `withSpacesInside`, `common/v1/rooms.ts`). An
  administrator's own lists stay personal; the install is read via `/v1/admin/*`.
- A write is authorised on every subject it names (an entry's grow, space, device, plants, media), not on a primary
  one. A write that must happen once rests on a unique index, and a duplicate key (E11000, `isDuplicateKey()` in
  `database/duplicate-key.ts`) is answered as already done: a read followed by a write cannot stop a race, and there
  are no transactions.
- `main.ts` and `http-compatibility.ts` keep what clients relied on from Express (listed in
  [ADR 0004](../adr/0004-server-on-nestjs-and-fastify.md#consequences), held by `test/specs/http-contract.spec.ts`).
  Registering a body parser through Nest drops both Fastify defaults, so `http-compatibility.ts` parses JSON and form
  bodies itself (the broker's auth backend posts forms), capped at 1 MiB (multipart files at 64 MiB). `@BodyLimit`
  raises one route's cap, for admins only (firmware binaries: 16 MiB): Nest hands Fastify only a route's `config`, so
  an `onRoute` hook (`common/body-limit.ts`) moves the limit into place and puts the admin check into `onRequest`,
  because Fastify reads a body before any guard runs.

## Sessions and accounts
- A sign-in is a `sessions` row and three JWTs: user 5 min, refresh 30 min (30 days with "stay signed in"), media
  30 days. Every authenticated request resolves its caller against session and account (`TokenService.resolve`), so
  revoking, deleting, deactivating or demoting acts at once, and a media token dies with its session.
- The media token counts only on `GET /v1/media/...` (it once opened the whole account).
- `DELETE /v1/sessions` and `PUT /v1/me/password` end every other session of the account.
- `@RateLimited` (per address and route, in memory) guards only the doors without a session: sign-in, sign-up,
  password reset, recovery and change, the demo and automation logins (each with its own budget, so demo visitors
  cannot throttle sign-ins), invite lookups, the public and Open Graph routes.
- Sign-in, password reset, adding a member by handle and invite previews answer alike whether or not the account or
  code exists. An inactive account gets 403 `account_not_activated` and its code mailed again (at most every 10 min).
- `DELETE /v1/me` and `DELETE /v1/admin/users/{id}` run one resumable cascade (`account-deletion.service.ts`). It
  refuses the `ADMINUSER_*` account (409 `admin_account_kept`), which the next boot would re-create anyway.

## Demo mode
- `POST /v1/sessions/demo` opens a session without an account (user id `demo`, never admin, its own rate budget). It
  reads objects with `isDemo`, redacted by `utils/demo.ts` (camera address, DID, uid, IP and errors, socket
  addresses, the hardware report's camera URL and socket list, URLs in lines); alarm targets and a plan's mail
  address are withheld by `alarm.wire.ts` and `plan.wire.ts`, as from anybody who may not manage the device.
  `DemoReadOnlyGuard` is global: anything but a read is 403 except under `/v1/sessions`, so no new write route can
  forget it.
- There is deliberately no UI or API to put a device into the demo (Chris, 2026-08-19). `./simulate-device.sh demo on
  -d <device-id>` sets `isDemo` in MongoDB on the device, its space and its cameras - any device of that stack, not
  only simulated ones. It does not flag the grow standing there; set `grows.isDemo` as well if the tour should show it.

## Share links and public pages
- The token comes as `X-Share-Token` or `?share=` and is looked up on every request, so revoking is immediate. A
  `public_page` link dies when its grow stops being public; a space link covers a grow only if the grow stood in the
  space within the link's window. A live link cannot be deleted (409 `share_link_live`); it is revoked first.
- A link or public reader must gain nothing. The window rule exists once, in `common/v1/range.ts`, as does whether a
  link or an invite still opens anything (`stillValid`); three private copies of the window had grown up and the grow
  report had none, which handed a fortnight's link the whole grow. Every route a link reaches clamps with it, applies
  the grant's `redacted` and `includeCameras`, and is tested outside the window. A film is served only when it lies
  wholly inside the window (refused, not cut); a grow's cover and film are exempt.
- Redacted readers get pictures re-encoded without metadata (migrated photos carried GPS), `null` device ids and
  camera owner, and only the diary kinds on the timeline. The share card is cached `public, max-age=300`, the Open
  Graph shell 120 s; a link's open counter is written at most once a minute.

## Media serving
- `GET /v1/media/{id}/content` (a session, the media token as `?token=`, or a share link) and
  `GET /v1/public/grows/{slug}/media/{id}` both hand the bytes over through `MediaDeliveryService`: byte ranges
  honoured (Safari plays no video without a 206), pictures for link and public readers re-encoded without metadata,
  `Cache-Control: private, max-age=3600` so no shared cache outlives a grow taken private. An export's bytes need a
  session, not the media token.
- Where `PREMIUM_ENFORCED` is set, a camera without entitlement has its stills served `PREMIUM_FREE_STILL_WIDTH`
  wide. Only the answer is narrowed, never the stored bytes, so an extended camera serves its history at full size
  again.
- Text drawn into stills, films and share cards needs the fonts the image installs (`server/Dockerfile`): without a
  font fontconfig can find, sharp renders SVG text empty.

## Broker and MQTT
- What the broker checks and what the ingest does with every topic: [device protocol](../device-protocol.md) §4-§8.
- MQTTS as Chris specified it (2026-06-25): certificates are `.env` values, not a folder - `MQTTS_CERT_PEM_B64`,
  `MQTTS_KEY_PEM_B64`, optional `MQTTS_CA_PEM_B64`, base64 PEM. The TLS listener starts only when cert and key are
  set; the plaintext listener always stays for old firmware; no client certificates. `scripts/setup-mqtts.sh` makes
  a CA and a server certificate for `MQTT_HOST_EXTERNAL`, writes them into `.env` and saves the CA key to
  `./mqtts-ca.key` (`MQTTS_CA_KEY_FILE`), never into `.env`; a later run rotates the server certificate under the
  same CA without touching a device. Lifetimes, rotation on a deploy host and the key's safekeeping:
  [MQTTS certificates](../runbooks/mqtts-certificates.md); the firmware side: [firmware.md](firmware.md).
- `rabbitmq/docker-entrypoint-wrapper.sh` runs as root: it writes the URL-encoded `MQTTAUTH_SHARED_SECRET` into the
  auth URLs (and refuses to start without one), and has to `chown` the certificate directory to `rabbitmq`, or the
  broker dies at boot with `ssl_options.keyfile invalid`.
- The server's client (`modules/mqtt/mqtt-client.service.ts`) is ended only when its first handshake fails; after
  that mqtt.js reconnects by itself. The old subscriber is dropped before a new one is attached, or every message is
  handled twice. `publish` answers `false` rather than throwing; an HTTP caller turns that into 503.
- One device's messages are handled in order (`DeviceIngestService` chains them per device): each handler re-reads
  the device row, and pairs like `webcam_did`/`webcam_ip` raced.

## Security decisions
- A claim code without the device password, for firmware that never reported `claimcode_auth=on`, is deliberate
  backward compatibility (Chris, 2026-08-25).
- No Flux from raw request input (Chris, 2026-08-25): only validated names and formatted instants are interpolated
  (`modules/data/flux.ts`, [data.md](data.md)) - a crafted range once read every account's readings.
- Logs keep request paths without query strings and with the `mqttauth` secret replaced (`common/log-path.ts`); every
  diary entry passes `withoutCredentials()` at write time - failed captures once wrote camera passwords into stored
  diary lines.
- Alarm webhook targets and headers (they can carry bearer tokens) are served only to whoever may manage the device
  and left out of exports.
- A check on a request's path reads it as the router matches it, which ignores case: `routePath()` and `isUnder()`
  (`common/route-path.ts`, no query, lower-cased). `/V1/media/...` reaches the same handler as `/v1/media/...`, so a
  check on the path as written is a way around it; the demo guard and the media token's reach use them.
- Every secret is compared with `sameSecret` (`common/same-secret.ts`: constant time, lengths in UTF-8 bytes) - the
  automation token, the broker's shared secret and the server's own broker password, legacy device passwords, the
  Telegram webhook secret and link signature. Never `===`, nor a bare `timingSafeEqual`, which throws on unequal
  lengths.

## Dependencies
- `@nestjs/common`, `core` and `platform-fastify` move together (12.1 of one does not compile against 12.0 of
  another). NestJS 12 ships ESM only and the server compiles to CommonJS, so `DOCKER_NODE_SERVER_IMAGE` must be a Node
  that can `require` ESM.
- sharp 0.35 refuses corrupt images, so test fixtures must be valid files. Which packages may run install scripts
  (`allowScripts`): [ci-and-release.md](ci-and-release.md).
