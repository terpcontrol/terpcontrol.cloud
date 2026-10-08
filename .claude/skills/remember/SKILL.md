---
name: remember
description: Records knowledge for good - a decision or instruction a person gives, the reason behind something, the cause of a non-obvious failure, a procedure. Decides first which repository it belongs in - technical knowledge goes into docs/ here, anything about the company into the private terpcontrol.com repository, never into this public one. Use it whenever such knowledge comes up in a session, and when a Stop hook asks for it.
when_to_use: A person states a rule, a decision or a fact, or an investigation found something a later agent cannot read from the code. Also /remember <knowledge>.
---

# Record knowledge

Goal: the knowledge `$ARGUMENTS` (or what just came up) stands in exactly one place, in the right repository, and
can be found through that repository's `docs/index.md`. The rules: [ADR 0003](../../../docs/adr/0003-knowledge-base.md).

## 1. Decide the repository - for every statement on its own
- **Here, terpcontrol.cloud (public):** the software - server, webapp, firmware, device protocol, Garmin app,
  simulator, build, CI, tests, the way of working in this repository, technical decisions and their reasons,
  pitfalls, root causes - and the user guides.
- **terpcontrol.com (private):** everything about the company - business and strategy, market and competitor
  research, product, roadmap and pricing decisions, reverse engineering of purchased hardware, suppliers, customers,
  sales, the shop, marketing, legal matters (e.g. KCanG), the website terpcontrol.com.
- **In doubt it is company knowledge.**
- A statement with both sides is split: the technical half here, the company half there. What is written here must
  not reveal the other half; at most it says that internal notes exist.

## 2. Technical knowledge: `docs/` here
1. Read `docs/index.md`. If a document covers the topic, add to it or correct it there - never a second document.
   Replace what is outdated instead of writing the new beside the old, and delete what no longer helps anyone
   (unless it still has value, e.g. for a migration).
2. If none does, pick the kind:
   - `docs/adr/NNNN-title.md` - a decision with its reasons: next free number, a status line, sections Context,
     Decision, Consequences. A superseded ADR stays and gets `Status: superseded by NNNN`.
   - `docs/knowledge/topic.md` - facts about one topic.
   - `docs/runbooks/procedure.md` - a procedure or a fix, step by step.
   New documents are in English; a German document stays German.
3. Frontmatter:
   ```yaml
   ---
   summary: One sentence that says when you need this document
   updated: YYYY-MM-DD   # today
   source: who said or found it, and when
   paths:                # optional: files whose editing makes the document relevant
     - firmware/**
   ---
   ```
4. Index: a new document gets a line in its group of `docs/index.md`, `- [Title](path) - when you need it`. If the
   gist of a document changed, change its line.
5. If the knowledge only matters while editing certain files and is easy to miss there, add a short rule with
   `paths:` to `.claude/rules/<topic>.md` that points to the document.
6. Run `node scripts/check-docs.mjs`. The knowledge goes into the same pull request as the code it belongs to.

## 3. Company knowledge: the private repository
1. Its checkout is `${TERPCONTROL_COM_DIR:-/Users/work/workspaces/terpcontrol.com}`. If it is missing, ask for the
   path. Never fall back to writing it here.
2. Work in a worktree on a branch of its own, so the checkout stays as it is. If this session already opened such a
   branch, add to it instead.
   ```sh
   COM="${TERPCONTROL_COM_DIR:-/Users/work/workspaces/terpcontrol.com}"
   git -C "$COM" fetch -q origin
   WT="$(mktemp -d)/terpcontrol.com"
   git -C "$COM" worktree add -q -b "docs/remember-$(date +%F)-<topic>" "$WT" origin/main
   ```
3. Record it there the way that repository's own `remember` skill says - its language, its `docs/` layout, its index
   and its check.
4. Commit, push and open a pull request there (`gh pr create`, run in `$WT`); do not merge it. Then
   `git -C "$COM" worktree remove "$WT"`.
5. Give the user the link. Here - in `docs/`, code, comments, commit messages, PR descriptions - write nothing of the
   content.

## Never
- Secrets (passwords, tokens, keys, credentials): write down where they are kept, not what they are.
- Anything that tells an attacker about a server - host names or domains of servers, IPs, paths, users, ports,
  versions, other services there, SSH aliases - in neither repository.
- Contact data of private persons.

Short and concrete: commands, paths and values rather than prose.
