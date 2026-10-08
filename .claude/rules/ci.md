---
paths:
  - .github/**
  - docker-compose.yaml
  - "*.sh"
  - scripts/**
  - server/Dockerfile
  - webapp/Dockerfile
  - .env.sample
---
Before changing CI, images, compose or the root scripts read `docs/knowledge/ci-and-release.md`; for backups,
restores and upgrades the runbooks in `docs/runbooks/`. Nothing about the servers deployed to - host names, IPs,
paths, users, ports, versions, SSH aliases - goes into code, comments, docs, commits or PR texts; deploy variables are
named, never valued.
