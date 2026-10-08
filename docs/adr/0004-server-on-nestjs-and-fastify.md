---
summary: Why the server is NestJS on Fastify and how it was moved there behind a black-box HTTP suite that still holds every change to the API's behaviour - read before touching the server's wiring, configuration, HTTP layer or its test harness
updated: 2026-10-08
source: PR #87 (merged 2026-09-10) and its commits, PR #95 (2026-09-11); checked against server/ on 2026-10-08
paths:
  - server/src/main.ts
  - server/src/app.module.ts
  - server/src/config/**
  - server/src/http-compatibility.ts
  - server/src/common/zod-validation.pipe.ts
  - server/test/**
  - server/package.json
---
# ADR 0004: The server on NestJS and Fastify, held by a black-box suite

- **Status:** accepted and carried out on 2026-09-10 (#87); recorded on 2026-10-08.
- **Date:** 2026-09-10
- **Touches:** `server/`

## Context

Until September 2026 the server was an Express application. Its services were module-level singletons, two of
which wrote to the database and started timers as soon as their file was imported, and its models were created at
import time. Nothing checked the configuration at start: a deployment without a database, a signing key, a log
directory or an admin account was not refused, and a port that was not a number bound to a random one. Middlewares
did the guarding, class-validator the validation, and the OpenAPI document was kept in JSDoc comments beside the
routes, where nothing held it to them.

Why NestJS and Fastify rather than another framework was not written down at the time; what follows is the
decision as it was carried out and what it bought.

## Decision

- **NestJS 12 on `@nestjs/platform-fastify`**, compiled with swc; the container runs `node dist/main.js`.
- **Everything is a provider.** A service takes its models, its collaborators and its configuration through its
  constructor. Work that starts with the server runs in `onModuleInit` and stops on shutdown, never at import.
- **One database connection, owned by Nest** (`@nestjs/mongoose`): opened before the modules that need it, closed
  on shutdown, schemas injected rather than created at import.
- **Typed configuration**: `@nestjs/config` namespaces in `src/config/configuration.ts`, checked at start by
  `src/config/validate-environment.ts`. A deployment that lacks what no request can be served without - the
  database, the signing key, the log directory, the admin account, the address it publishes - is told everything
  missing at once and refuses to start. Defaults belong in `docker-compose.yaml`, not in this code (`AGENTS.md`).
- **Guards** instead of middlewares; a **Zod pipe** (`src/common/zod-validation.pipe.ts`) instead of
  class-validator, validating against the contract's own schemas; **OpenAPI generated from the controllers**
  (`src/openapi.ts`, served at `/api-docs`) instead of comments kept beside them.

How the move was made is the part that lasts:

- **A black-box suite is the contract** (`server/test/specs`, described in `server/test/README.md`). It drives the
  API over HTTP against a server process started for the run and never imports application code: a real MongoDB
  (mongodb-memory-server, authenticated) and MQTT broker (aedes, in-process), fakes for InfluxDB and SMTP that the
  specs can read, the real ffmpeg behind a shim that records every run. Written against the Express server first,
  it held both implementations to the same behaviour while requests went to NestJS where it had the route and to
  Express otherwise; a route counted as moved when its specs passed unchanged. CI runs it against the compiled
  output (`HARNESS_BUILT=1`), which is what the container ships.
- **A bug found on the way is fixed, not reproduced**, and named in the pull request for a conscious sign-off.
  The move found a claim code that was never spent, a malformed MQTT payload that ended the process for every
  device, secrets reaching logs and answers, and administrator writes that answered "ok" and wrote nothing.

## Consequences

- The same suite carried the `/v1` rewrite ([ADR 0001](0001-app-rewrite-data-model.md)) and holds every change
  since. A spec describes what the server does, including where that looks wrong: a change of behaviour changes
  the spec and the comment at its assertion together, or the next reader cannot tell a decision from a regression.
- NestJS 12 ships as ESM while the compiled server is CommonJS, so the server needs a Node that can `require()` an
  ES module (the repository asks for 24.15 or newer throughout). A unit spec that imports a service runs as ESM in
  a second jest project (`jest.unit.config.js` with `--experimental-vm-modules`, `tsconfig.unit.json` without
  decorator metadata; #95). `npm test` runs both suites.
- Fastify's plugins default differently from the Express middleware they replaced, and no single route's specs
  show it: CORS allowed three methods, compression stripped the `Content-Length` an OTA client reads, a trailing
  slash answered 404, a repeated query parameter arrived as an array, an empty JSON body was refused. `main.ts`
  and `src/http-compatibility.ts` keep what clients in the field depend on, and `test/specs/http-contract.spec.ts`
  holds it. Keep both in view when touching the HTTP layer.
- Rate limits are counted in the process (`src/common/rate-limit.guard.ts`). That is exact while compose runs one
  server process; a second instance needs a shared store first.
