# Integration suite

`npm run test:integration` (from `server/`). Everything the suite needs is started for it; there is nothing to set up
beyond `npm install`.

The suite drives the API the way a client does — over HTTP, against a server process started for the run. It never
imports application code, so it is a contract rather than a mirror of the implementation: `TARGET=nest npm run
test:integration` runs the same specs against the NestJS app, and a route counts as migrated when its specs pass on
both.

## What runs during a test

| Dependency | Stand-in |
| --- | --- |
| MongoDB | `mongodb-memory-server`, with authentication on, like production |
| MQTT broker | `aedes`, in-process — specs publish as a device and watch what the server publishes back |
| InfluxDB | a fake that speaks the v2 write and query API and answers Flux queries from what it stored |
| SMTP | `smtp-server`, capturing mail instead of sending it |

Both fakes live in the jest main process, so the specs reach them through an HTTP control plane
(`support/control.ts`): seed measurements, read captured mail, reset between tests.

`convert` (ImageMagick) and `ffmpeg` must be on PATH — the image endpoints shell out to them, exactly as the container
does.

## Writing a spec

- `support/api.ts` creates sessions (`createAccount`, `loginAsAdmin`, `demoSession`). Each client sends its own
  `X-Forwarded-For`, because the API rate-limits per address and specs would otherwise exhaust each other's budget.
- `support/device.ts` registers and claims devices, and `startSimulator` stands in for firmware on the MQTT bus.
- Every spec makes its own users and devices with unique names: one database and one app process are shared by the
  whole run.

## When a test disagrees with the code

The specs describe what the server does today, including where that looks wrong — those cases are commented as such at
the assertion. Change the behaviour and the comment together, or the next reader cannot tell a decision from a
regression.
