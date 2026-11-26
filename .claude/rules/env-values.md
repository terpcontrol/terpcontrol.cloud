---
paths:
  - .env.sample
  - docker-compose.yaml
  - scripts/load-env.sh
---
A new env variable whose value can hold spaces or quotes (HTML, a script tag) must be excluded in
`scripts/load-env.sh` like `CUSTOM_LINKS_HTML` and `CUSTOM_SCRIPT_TAG`: its `xargs` export breaks on it, and every
root script under `set -e` - the nightly backup included - then stops at its first line. See
`docs/runbooks/backup-and-restore.md`, "On a deploy host".
