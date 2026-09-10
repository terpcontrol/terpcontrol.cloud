# Tests

`npm test` (from `server/`) runs both suites: the unit specs in `unit/` first, then the integration specs in
`specs/`. Everything either needs is started for it; there is nothing to set up beyond `npm install`. Each has its
own jest config (`jest.unit.config.js`, `jest.integration.config.js`) and can be run on its own with `npm run
test:unit` / `npm run test:integration`.

## Integration suite

The suite drives the API the way a client does — over HTTP, against a server process started for the run. It never
imports application code, so it describes the API rather than mirroring the implementation: it is what carried the
server from Express to NestJS a route at a time, with both held to the same specs.

`HARNESS_BUILT=1 npm test` runs the same specs against `dist/` (build it first) instead of the sources, which is what
the container ships — the swc build has its own decorator and path handling, and a suite that only ever ran through
ts-node would not notice it breaking. `HARNESS_VERBOSE=1` adds the server's own log output. Neither reaches the unit
specs, which load the sources either way.

### What runs during a test

| Dependency | Stand-in |
| --- | --- |
| MongoDB | `mongodb-memory-server`, with authentication on, like production |
| MQTT broker | `aedes`, in-process — specs publish as a device and watch what the server publishes back |
| InfluxDB | a fake that speaks the v2 write and query API and answers Flux queries from what it stored |
| SMTP | `smtp-server`, capturing mail instead of sending it |

Both fakes live in the jest main process, so the specs reach them through an HTTP control plane
(`support/control.ts`): seed measurements, read captured mail, reset between tests.

`convert` (ImageMagick) and `ffmpeg` must be on PATH — the image endpoints shell out to them, exactly as the container
does. The app under test finds a shim first (`support/infra/fake-bin/ffmpeg`): it records the arguments of every run
and hands the run to the real ffmpeg, so stills still come from actual streams. What the server runs ffmpeg with, and
what it does with a run that failed, is not visible in an HTTP answer otherwise; `support/ffmpeg.ts` is how a spec
reads those runs and, where it needs a particular camera, answers one of them itself.

### Writing a spec

- `support/api.ts` creates sessions (`createAccount`, `loginAsAdmin`, `demoSession`). Each client sends its own
  `X-Forwarded-For`, because the API rate-limits per address and specs would otherwise exhaust each other's budget.
- `support/device.ts` registers and claims devices, and `startSimulator` stands in for firmware on the MQTT bus.
- Every spec makes its own users and devices with unique names: one database and one app process are shared by the
  whole run.

### When a test disagrees with the code

The specs describe what the server does today, including where that looks wrong — those cases are commented as such at
the assertion. Change the behaviour and the comment together, or the next reader cannot tell a decision from a
regression.

## Unit suite

`unit/`, for behaviour the integration suite cannot reach: the daily cleanup sweep has no route of its own, and the
Terp Cam fallback decides between two paths that both end in a rendezvous server the harness has nothing to answer
with. A spec here constructs the service itself and passes it what it needs.

It is a separate jest project because it has to run as ESM. NestJS 12 ships ESM only, so importing any service into
jest's CommonJS runtime dies on the `import` in `@nestjs/common`; this project treats `.ts` as ESM and needs
`--experimental-vm-modules` on the node running jest, which `npm run test:unit` passes. Two things follow from that:

- `jest` is not a global. Import it: `import { jest } from '@jest/globals'`.
- `jest.mock` does not work. A module is linked before the file importing it runs, so a replacement has to be
  registered ahead of that - `jest.unstable_mockModule`, from `unit/setup.ts` or before a dynamic `import()`.
  `unit/setup.ts` already replaces the logger, which every service pulls in.

`tsconfig.unit.json` compiles with `emitDecoratorMetadata` off. Nothing here asks Nest to inject anything, so the
parameter types the decorators would record are never read - and emitting them turns every type-only import into a
runtime one, which ESM then has to find as a named export. Mongoose's `Connection` is not one; the package leaves it
out of its ESM surface deliberately.

`unit/support/database.ts` starts a real MongoDB for the specs whose behaviour is in their queries. A stubbed model
would only ever confirm that the spec and the service agree on what to stub.
