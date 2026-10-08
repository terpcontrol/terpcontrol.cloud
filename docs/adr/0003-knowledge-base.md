---
summary: How knowledge is kept - docs/ in English with an index loaded in every session, the line between this public repository and the private one, the hooks and skills that hold it, the CI check
updated: 2026-10-08
source: Chris (2026-10-08)
paths:
  - docs/**
  - .claude/**
  - CLAUDE.md
  - scripts/check-docs.mjs
---
# ADR 0003: A knowledge base in the repository

- **Status:** accepted on 2026-10-08.
- **Date:** 2026-10-08
- **Touches:** `docs/`, `.claude/`, `CLAUDE.md`, `scripts/check-docs.mjs`, `.github/workflows/build.yml`

## Context

What agents learn in sessions - above all from people - has to outlive the session and be quick to find for the
next agent. Claude's auto memory lives on one machine under `~/.claude` and never reaches git. And this repository is
public: the company side of Terp Control is kept in the private repository terpcontrol.com, while many sessions
here produce knowledge for both.

## Decision

- **Layout.** `docs/adr/` (numbered decisions), `docs/knowledge/` (facts per topic), `docs/runbooks/` (procedures).
  Documents older than this ADR (`device-protocol.md`, `app-rewrite-handover.md`) stay where they are, because code
  and other documents link them. Images sit next to the document that shows them and need no frontmatter.
- **Language.** English for new documents; a German one stays German.
- **Index.** `docs/index.md`, one line per document saying when you need it, imported into every session by
  `CLAUDE.md`. The documents themselves are read when needed.
- **Frontmatter** on every document: `summary`, `updated` (YYYY-MM-DD), `source` (who, when), optionally `paths`.
- **Recording while working.** Knowledge goes into the same pull request as the code, with the `remember` skill.
- **The line between the repositories** (Chris, 2026-10-08). This repository takes technical and architectural
  knowledge about the software, and the user guides - nothing else. Everything about the company - business and
  strategy, market and competitor research, product, roadmap and pricing decisions, reverse engineering of purchased
  hardware, suppliers, customers, sales, shop, marketing, legal matters - belongs in terpcontrol.com, also when the
  session runs here: `remember` writes it there on a branch of its own and opens a pull request there. In doubt it
  is company knowledge. A topic with both sides is split; this repository may say that internal notes exist, never
  what they say. The private repository may link to documents here.
- **Keep only what helps** (Chris, 2026-10-08). Outdated content is deleted unless it still has value ahead, e.g.
  for a migration. A superseded decision is not deleted but marked `superseded by NNNN`.
- **Safety nets** in `.claude/settings.json`:
  - a prompt Stop hook asks at the end of every turn whether knowledge came up that is not recorded yet, or whether
    the reply shows company knowledge written here, and sends the agent back to the `remember` skill;
  - `.claude/hooks/recorded.mjs` covers what that hook cannot see - it gets only the agent's reply: when the person's
    last message reads like a decision or an instruction and the turn recorded nothing, it sends the agent back
    once, also when the person asked for nothing but "OK";
  - `.claude/hooks/guard.mjs` runs at the end of every turn and before `git push` and `gh pr create|edit|comment`.
    It scans what the branch adds - files, commit messages, the pull request text - for company terms and amounts
    of money, secrets and server details, and sends the agent back with the lines it found. Each hit is reported
    once; the agent decides whether it is real. Patterns that would themselves give something away - the host name
    of a server, say - are kept per machine in `~/.claude/terpcontrol-guard-patterns`, one regular expression per
    line, never in the repository.
- **Auto memory is off** for this repository (`autoMemoryEnabled: false`), so nothing lands silently in `~/.claude`.
- **Consistency.** `node scripts/check-docs.mjs` requires frontmatter and an index line for every document and
  checks the index's links; it runs in CI (`build.yml`, job `docs`).
- **Tidying** is done by hand with `/docs-consolidate`, which also proposes moves to the other repository. There is
  no scheduled run.
- **No secrets** in `docs/` - only where they are kept.
- **Nothing about servers** - no host names or domains of servers, IPs, paths, users, ports, versions, other
  services there, SSH aliases - in `docs/`, code, comments, commit messages or pull request descriptions. The one
  exception is a user guide that needs an address to work (`UPGRADING-FIRMWARE.md`).

## Consequences

- The prompt hook costs one small model call per turn, the guard one `git diff`.
- Recording company knowledge from a session here needs a checkout of terpcontrol.com; without one, `remember` asks
  for its path. A contributor without access to it cannot record such knowledge - and must not record it here.
- Area-specific hints go into `.claude/rules/` with `paths:`, not into `CLAUDE.md`.
