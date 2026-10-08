---
name: docs-consolidate
description: Tidies the knowledge base in docs/ - checks statements against code and configuration, merges duplicates, deletes what is outdated, finds what belongs in the private terpcontrol.com repository and proposes the move, keeps the index - and opens a pull request for it. Only when asked.
disable-model-invocation: true
---

# Consolidate the knowledge base

The rules: [ADR 0003](../../../docs/adr/0003-knowledge-base.md).

1. Branch from the current `master` (`docs-consolidate-YYYY-MM-DD`).
2. Read `docs/index.md` and every document.
3. Check every statement that can be checked - paths, file names, commands, environment variables, defaults,
   behaviour - against the code, `docker-compose.yaml` and the workflows. Correct what is wrong and set `updated`.
   Leave what cannot be checked.
4. Merge what is said twice and resolve contradictions: the newer source wins, in doubt ask. A superseded ADR stays
   and is marked `superseded by NNNN`.
5. Delete what is outdated and has no value ahead (value ahead: e.g. a migration still needs it), and what the code
   now says itself.
6. **Wrong repository.** Look for company knowledge: prices, costs, margins, suppliers, customers, sales, market or
   competitor figures, strategy, roadmap or pricing decisions, reverse engineering of purchased hardware, legal
   matters. Do not move it on your own and do not quote it in the pull request, which is public: name the place
   (`docs/x.md`, section) and the proposed target in the private repository, and ask. After the OK, write it there
   with the `remember` skill (step 3) and remove it here in the same pull request.
7. Look for secrets and server details (host names or domains of servers, IPs, paths, users, ports, versions, SSH
   aliases) and for contact data of private persons; they belong in no repository - remove them and say so.
8. Split documents longer than about 200 lines by topic; check `.claude/rules/` for references that point nowhere.
9. Reorder the index; every line says when you need the document. Run `node scripts/check-docs.mjs`.
10. Commit, push, open a pull request listing the substantive changes and the proposed moves. Do not merge it.
