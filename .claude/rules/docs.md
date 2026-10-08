---
paths:
  - docs/**
---
Documents in `docs/` are English (a German one stays German), carry frontmatter (`summary`, `updated`, `source`,
optional `paths`) and a line in `docs/index.md`. When you change one, set `updated`, keep the index line true and run
`node scripts/check-docs.mjs`. Technical knowledge only: anything about the company goes to the private repository
with the `remember` skill. No secrets, no server details. Rules: `docs/adr/0003-knowledge-base.md`.
