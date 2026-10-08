---
summary: How agents and people work here - branches and pushing, PR review comments, long runs and rounds, what needs Chris's word, commit and PR texts, worktrees and parallel agents
updated: 2026-10-08
source: Chris's instructions in sessions and PR reviews 2025-10..2026-10 (dated inline); root causes agents found in those sessions; the commit and PR history (trailers read from master 2026-10-08)
paths:
  - .claude/**
  - .worktreeinclude
  - AGENTS.md
  - CLAUDE.md
---
# Development workflow

Chris's standing instructions for working in this repository, and what sessions learnt the hard way. Code style,
configuration, checks and the stack are in [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md); how
knowledge is recorded, and what never goes into this public repository, is [ADR 0003](../adr/0003-knowledge-base.md).
Checks and test stacks in detail: [testing](testing.md); releases and deploys: [CI and release](ci-and-release.md).

## Branches and pushing
- **Cut a new branch from a freshly fetched `origin/master`.** Chris squash-merges PRs, so a branch cut from an
  older, already merged branch carries its commits again (a one-function change once showed 16 commits). It happened
  because `git checkout master` failed on a dirty tree with its stderr silenced: never silence the errors of a git
  command that changes state, and check with a ref (`git log --oneline origin/master..HEAD`), not a bare `git log`.
- **Work on the PR's own branch the whole time** (Chris, 2026-10-03), not on a side branch pushed into it. To switch:
  check that the PR branch on origin equals your state, check it out, delete the side branch.
- **A problem Chris finds while testing an open PR is fixed on that PR's branch** (Chris, 2026-08-25), not in a new
  branch or PR. After the merge, a follow-up is a new PR from master (see [Review comments](#review-comments)).
- **Push after every round or finished step**, once the checks are green and read in their own command (Chris,
  2026-09-24; [AGENTS.md](../../AGENTS.md), Before committing): fetch first, push a fast-forward. Pushing the session's
  own branches is standing authorisation; never push master or anybody else's branch, and leave Chris's own checkouts
  alone - they hold his untracked files.
- **Pushed history is not rewritten** - no rebase, squash or force-push - unless Chris allows it for the case. For
  bringing master into a long-running branch he left the method open; a merge of master needs no force-push.
- **Agents never merge a PR.** Chris merges. Before he does, present the finished state: what was built and checked,
  what was left out and why.
- **A long-running PR gets a final integration round** before it is handed over (Chris, 2026-10-03): everything master
  gained meanwhile comes in. Plan where each master commit lands, resolve conflicts commit by commit (a change to code
  the branch replaced is ported into its replacement), build and test on a stack, then let a fresh agent check commit
  by commit that every master change is really in.
- **Replacing a whole file** (a `package.json`, a config): diff old against new for developer-facing scripts and
  settings. The rewrite dropped `start:public` from `webapp/package.json` that way, and no merge of master could bring
  it back, because the commit that added it predates the branch point.

## Review comments
- **Chris files requests as GitHub review comments, and they are not delivered to a session.** At the end of every
  round, before reporting that everything is done and before a merge, read all three for every PR the session
  touches, and treat each comment as a requirement (on #104 one sat unread while "all done" was reported):
  ```sh
  gh api --paginate 'repos/{owner}/{repo}/pulls/<N>/comments'    # inline review comments
  gh api --paginate 'repos/{owner}/{repo}/issues/<N>/comments'   # the conversation
  gh api --paginate 'repos/{owner}/{repo}/pulls/<N>/reviews'     # review bodies
  ```
  A PR merely attached to a session delivers none of its comments. Offer to switch comment delivery on; do it only
  on his yes.
- **Merged with a comment still open** (#124 -> #125, #129 -> #130): answer in that thread and bring the change as a
  follow-up PR from master. His comments can sit in a review he has not submitted yet; a reply from the same GitHub
  account joins that pending review and stays invisible until he submits or discards it.
- **A finding that has come up before is persisted, not only fixed** (Chris, 2026-09-30): write the rule behind it
  where agents read it - `AGENTS.md` for a code convention (its Configuration section came about that way, #125),
  `docs/` for the rest.
- Files attached to issues of a private repository cannot be downloaded with an API token (GitHub serves them to a
  browser session only). Ask for the file to be committed or handed over another way.

## Long runs and rounds
A round is one pass of building or fixing with its checks, ending in a short report and a push.
- **Carry on from round to round without waiting** (Chris, 2026-09-18 and 2026-09-22). A status report is not a
  stopping point. When he pauses the run, the round in progress is finished first (2026-09-19).
- **Stop only for a question that decides what gets built**, and ask it with a recommendation, not a menu. Do the
  work rather than handing Chris a list of what could be done.
- **No task chips (`spawn_task`) during a run of rounds** (Chris, 2026-09-24, said twice): give side work - a flaky
  test, a stale doc - to a sub-agent in the current round and name it in the round's report.
- **Converge, do not expand** (Chris, 2026-09-24, after one pass had used 132 agents): small rounds with a few fix
  agents and a light check; the fixer verifies its own fix on screen; a separate refuter only for a claim genuinely in
  doubt; a stated finish line. The goal is a consistent, bug-free, nicely designed and self-explanatory app.
- **Loops of critic agents are for the app's screens**, judged from the running app and its screenshots, not code.
  A backend or data-model design is written up directly, and a step that looks like paperwork is done directly
  rather than orchestrated (Chris, 2026-09-17/18).
- **Measure, do not believe** (Chris, 2026-08-28): a design that rests on a performance claim ("costs practically
  nothing") waits for a measurement on the real system - several runs, medians. In #88 the measurement overturned the
  claim and changed the design.
- **Nothing lives only in the session** (Chris, 2026-09-22). Commit work as it lands; a scratchpad can be cleared (two
  rounds of screenshots were lost that way). When a session has to hand over - an account switch, a full context -
  commit and push everything, record the state and the way of working in `docs/` (company matters in the private
  repository), and give Chris one paste-able prompt naming the worktree, the branch and what to read in which order.
- **After the desktop app restarts a session, check the checked-out branch**: it can reset the session's worktree to
  the branch the session started on (a test stack once came up with the pre-rewrite app).

## Showing work to Chris
- **Screenshots:** show the occasional interesting one taken anyway while verifying - two or three per round: a new
  screen, a state that is hard to picture (offline, an error), a result that differs from what was decided. Never take
  one just to show him (Chris, 2026-09-18). Screenshots kept as a record of design work go to the private repository
  as each round lands, never into this one.
- **Visual options and comparisons as a Claude artifact**, with the pictures attached as files: Chris cannot open
  local HTML files (Chris, 2026-09-30). An artifact is private until it is shared.
- **Improvement proposals as real prototypes** (Chris, 2026-09-30): several concepts, each a running prototype in its
  own worktree, shot with real data on desktop and phone and set side by side on one comparison page. Only the concept
  he picks is then carried through the app. A panel of judge agents is no proxy for his taste: show him screenshots
  early and let him choose (Chris, 2026-09-24).
- **A design that needs his sign-off** comes with an executive summary that lists only what he has to approve, check
  or answer; each open question names the assumption that stands until he answers (Chris, 2026-09-17). Leave the list
  as a Claude artifact he can read, edit inline and comment on from any device; he answered the rewrite's backend
  sign-off there (2026-09-19).
- **Say what is not done** (Chris, 2026-09-22): a failing test is shown with its output, a skipped step is named - in
  a round's report as in a PR's `Checked`.

## What needs Chris's word
- Merging a PR; rewriting pushed history.
- A change to a recorded decision (an ADR), to the data model or to the agreed scope: agreed with him before it is
  built, and his answers go into the ADR (Chris, 2026-09-16).
- **Production.** Releases reach it through the `Deploy` workflow; a hotfix by hand is the exception
  ([CI and release](ci-and-release.md#deploying-by-hand)). No command runs against the production host, read-only
  inspection included, before Chris has approved the exact command list: every step verbatim (backup, an `rsync` dry
  run listing what `--delete` removes, deploy, log watch) with its consequences, such as a rollback that only goes one
  way. In auto mode the permission classifier refused `rsync` and `ssh` to that host (2026-09-23); hand him the
  approved commands for his own terminal.
- **Devices and cameras are debugged off production** (Chris, 2026-09-24): test hardware is connected to staging or a
  local stack.
- Taking over Chris's own local stack (stopping it so the physical development devices connect to yours), writing to
  a database that holds real data, changing a real account's settings. What a test creates on real data - a share
  link, an alarm rule - is removed again afterwards.
- Switching on comment delivery for a PR; a hook that blocks legitimate work (see below).

## Commits and PR texts
- In English. **Subject:** short and imperative, with the area in front where one fits (`Terp Cam: heal a stale
  paired-camera P2P id instead of blocking`). **Body:** prose saying why - the problem, its cause, what changes - not
  bullet lists of the obvious.
- Chris squash-merges: master's commit is built from the branch's commit messages (and the PR title, when there are
  several), so write each commit for master's history. Issue and PR numbers go into commit messages, never into code
  comments ([AGENTS.md](../../AGENTS.md), Code style).
- **PR description:** what and why first, then sections such as `## Why`, `## What changes`, `## Checked`. `Checked`
  names what was run and seen, and also what was not ("not yet checked in a running stack").
- **Attribution, as master's history shows it:** a commit keeps the trailer the harness adds
  (`Co-Authored-By: Claude ... <noreply@anthropic.com>`; from a web session also a `Claude-Session:` link), a PR
  description its "Generated with Claude Code" line. The squash merge folds the co-authors into one `Co-authored-by:`
  line at the end of master's commit, as on most commits since the rewrite (#134, #136, #137, #140-#143). The ban on
  model names and `Co-Authored-By` lines was the rewrite branch's own rule (#104 carries none) and ended with it.
- **Everything here is public**: code, comments, commit messages and PR texts
  ([ADR 0003](../adr/0003-knowledge-base.md); `.claude/hooks/guard.mjs` checks at the end of every turn and before
  `git push` and `gh pr`). A secret that reached an unpushed commit: rewrite those commits before the first push,
  then read the whole PR diff for collateral edits (a filter over every `.md` once also rewrote an unrelated skill
  file). Keep such values in a git-ignored local file. A secret that was pushed is public: tell Chris.

## Code and documentation
- **No foreign URLs or IPs in the code** (Chris, 2026-09-08): one that is unavoidable comes from an environment
  variable, defaulted in `docker-compose.yaml` ([AGENTS.md](../../AGENTS.md), Configuration). It was said about
  third-party servers; the public endpoints of the notification integrations (Telegram, ntfy) are in the code today.
- **Remove what is obsolete completely**: a field goes from the code, the contract in `shared-types/` and what is
  generated from it, instead of staying as deprecated ("Just remove it", Chris, 2026-07-09). Data still in the
  database is a migration's business; see "keep only what helps" in [ADR 0003](../adr/0003-knowledge-base.md).
- **A configuration sample says what a component has to do, not how one product is configured**: Chris had the nginx
  examples taken out of `.env.sample`, which says what a reverse proxy must pass on (2026-09-30, #124). The nginx
  specifics live in [CI and release](ci-and-release.md#reverse-proxy-in-front-of-the-api).
- **A measurement that contradicts an earlier conclusion** marks that conclusion as retracted, with the evidence,
  instead of deleting it silently (Chris, 2026-09-08).
- **Comments are prose in complete sentences** that say why ([AGENTS.md](../../AGENTS.md), Code style): read the file
  you are editing and match how it comments.
- What goes into `README.md` and what into comments: [CLAUDE.md](../../CLAUDE.md), Documentation.

## Worktrees and parallel agents
- **Agent worktrees are created in the repository of the launching session's working directory.** Launch cloud work
  from the cloud checkout. A workflow once launched from the private checkout put cloud code into the private
  repository's object store; if that happens, check that no commit is shared with the private history, bring the
  commits across, and remove the stray worktrees and branches.
- **A worktree agent can start on a stale commit** (the main checkout's HEAD) rather than the branch tip, and git
  refuses to check out a branch another worktree holds. Brief every worktree agent to `git reset --hard <branch tip>`
  before any work and to commit on its own worktree branch; the lead cherry-picks or fast-forwards.
- **A fresh worktree has no `node_modules`**: `npm ci` in `shared-types/`, `server/` and `webapp/` before any check is
  believed - without it `npx tsc` can report 0 errors for a project it never compiled ([testing](testing.md)).
  `.worktreeinclude` names the git-ignored local files that are copied into a new worktree.
- **Several agents in one worktree**: a red check may be somebody else's half-finished edit. Measure your change on a
  throwaway tree (`git archive HEAD` plus only your files) - never `git stash`, whose stack all worktrees and sessions
  share. Stage and commit by explicit path (a staged `git rm` once landed in another agent's commit), give scratch
  directories unique names (shared ones killed each other's Jest runs), and re-run all checks once the others landed.
- **Parallel slices**: land a scaffold commit first (contract additions, routes, stubs, shared modules) so slices never
  meet in the same files, and give each agent a disjoint file list with a do-not-touch list. A defect that cuts across
  survives in the files an agent may not touch, so each agent reports what it could not fix and the next round routes
  it - or a guarding test pins the known offenders in a list that must keep failing (`NOT_YET` in
  `webapp/test/zone.test.ts`), and whoever fixes one has to delete its line.
- **Merging their work**: seams appear where two agents extended the same import line, shape or test fake; resolve
  them keeping both sides, in a commit naming the seam. Conflicts in the generated contract are regenerated, never
  merged by hand ([CI and release](ci-and-release.md#pull-request-checks)). In the i18n catalogues
  (`webapp/public/assets/i18n/*.json`) each agent edits its own namespace and writes the file by script in its format
  (`json.dumps(d, indent=2, ensure_ascii=False) + "\n"`); conflicts get a three-way JSON merge.
- **After merging, build cold**: `npm ci` and every check before pushing. Each agent's build was green in its own
  worktree while the merged branch failed on two new `@fontsource` packages its `node_modules` predated. A dev server
  that keeps running needs the reinstall too, or it serves fallback fonts.
- **Never get round a hook or guard**, e.g. by writing through the shell what Edit was refused. A session hook refuses
  Edit/Write into another session's worktree: launch the agent with its working directory inside its own worktree. If
  a hook blocks legitimate work, tell Chris.
- **Sub-agents inherit the session's model**: launch them without a model override, at a reasoning effort that fits
  the task (Chris, 2026-09-17 and 2026-09-24). `model: "opus"` resolves to whatever the account maps that alias to -
  on 2026-09-24 an older model, whose weekly limit stopped six fix agents mid-work; those that had committed each
  finding as they went could be finished from their worktrees.
- **Cleaning up**: worktrees pile up under `.claude/worktrees/` (git-ignored; tens of GB after a day of rounds). Remove
  one only when each of its commits is on the target branch (same patch-id and subject), its untracked files match the
  main checkout's, and its simulators and dev servers are stopped by PID; keep one whose commits match nothing until
  someone confirms. `.claude/skills/`, `.claude/hooks/`, `.claude/rules/` and `.claude/settings.json` are tracked and
  must survive a cleanup; `.claude/launch.json` describes one machine's preview server and is never committed.

## Background
- The history starts on 2025-10-28 with the original developer's public release of the Plantalytix stack; Chris
  maintains it since. Names such as `fg2`, `fg_*` and `plantalytix` were inherited, not designed here
  ([NOTICE](../../NOTICE)).
- The license is Apache-2.0, and contributions come under it without a separate agreement
  ([README](../../README.md#license)).
