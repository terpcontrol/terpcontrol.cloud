---
paths:
  - server/**
  - shared-types/**
---
Before changing the server read `docs/knowledge/server.md` (and `server-engines.md` for alarms, plans and device
settings); for schemas, queries, sweeps and exports `docs/knowledge/data.md`; for migrations
`docs/knowledge/data-operations.md`. The model and the /v1 contract are decided in `docs/adr/0001-app-rewrite-data-model.md`,
the framework in ADR 0004, times of day and day/night in ADR 0005 and 0006. Env defaults live in
`docker-compose.yaml`, not in server code. The device side of the server follows `docs/device-protocol.md`.
