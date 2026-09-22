# The app rewrite, as it stands

Written for whoever picks this up next. It is the technical half; everything about what was decided and why,
and what is still waiting on Chris, is in the private `terpcontrol.com` repository under
`docs/app-redesign/`.

## Where the work is

| | |
| --- | --- |
| Branch | `claude/wizardly-lamport-sulte9`, in both repositories |
| Pull request | terpcontrol/terpcontrol.cloud#104, still a draft, **not to be merged without Chris's word** |
| Decision record | `docs/adr/0001-app-rewrite-data-model.md`, accepted, revision 3, amended several times since |
| Device protocol | `docs/device-protocol.md`, **frozen**: no route, topic or payload may change |
| Migrations | `server/src/migrations/README.md` explains the runner, the steps, the preflight and the rejects |

Do not rewrite history on that branch and do not push to any other without asking.

## How far it has got

The delivery order is the table at the end of the decision record. Rounds 0 to 7, 9 and 10 are built, server and
app. Round 8 is visual direction and needs no backend.

| Round | State |
| --- | --- |
| 0 Foundation | done: schemas, 15 migrations, the device-protocol module, the engines on the new collections |
| 1 Shell and home | done |
| 2 Grow and tent pages | done |
| 3 Logging | done |
| 4 Timeline | done |
| 5 Devices | done |
| 6 Public diary | done, after ten leaks were found and closed |
| 7 Lifecycle | done |
| 9 Controller | done, server and app |
| 10 Alarms, tasks, notifications | done, server and app, after two rounds of criticism |
| 11 Onboarding | done, server and app, after two rounds of criticism |
| 12 Measurements and charts | done, server and app, after one round of criticism |
| 13 Sharing | done, server and app, after one round of criticism and its fixes |
| 14 Account, entitlement, admin | done, server and app, after one round of criticism and its fixes |

Every round is built and criticised. What is left of the phase is the migration verified against a restored
backup with the app driven over the real data, then the consistency sweep and the end-to-end tests.

## What the checks are

Four for the server, four for the app, each **read in its own command before committing**. A command that tests
and commits in one line commits whatever the tests said; that is how three failing specs once reached the branch.

```sh
cd server && npx tsc --noEmit -p tsconfig.json --pretty false 2>&1 | grep -c "error TS"   # must print 0
cd server && npm run lint && npm run test:unit && npm run test:integration

cd webapp && npx tsc --noEmit -p tsconfig.json --pretty false 2>&1 | grep -c "error TS"
cd webapp && npm run lint && npx vitest run && npm run build
```

`--pretty false` is not optional. With pretty output on, `tsc` writes colour codes between "error" and "TS", so
the grep prints 0 on a project that does not compile. Both of these are also in `AGENTS.md`.

At the last full run: 899 server unit tests, 517 server integration tests, 703 app tests, everything else clean.

The integration suite needs the machine to itself. One run of it while five agents were driving a browser and a
compose stack failed nineteen tests in three suites; three runs since, with nothing else going on, have been
clean. It starts its own MongoDB and its own app on ports it picks, and that is what contention breaks.

`npm run test:live` in `webapp/` needs a stack up and is not part of `npm test`.

## Rules that have each been learnt the hard way

- **Access decisions go through `access(ctx, subject, need)`.** Never hand-roll an ownership check.
- **A list combines its visibility filter with the pagination cursor using `$and`**, never by spreading the
  cursor beside an `$or`. That bug has been found three times, each time leaking other people's rows.
  `SpacesService.list` is the reference.
- **A public reader or a share-link holder must gain nothing.** Round 6 closed ten leaks of exactly that kind.
  Anything reachable through a link respects `clampRange(grant)`, `grant.includeCameras` and `grant.redacted`.
  Assert the *absence* of what must not be there, not merely the presence of what must.
- **The firmware version is a build uuid and cannot be compared.** A control a build has not announced is
  refused in the app with the reason, never drawn as a switch that silently does nothing.
- **Honest state.** A value that is old is dimmed and dated, never hidden and never silently refreshed. The age
  comes from the server's clock, never the browser's. `VALUE_AGE` is one shared constant.
- **Both themes, both widths, both languages.** Dark and light, phone and desktop, English and German, with no
  English left in the German catalogue and no hard-coded colour anywhere.
- **Doc comments are prose in complete sentences explaining *why*.** Read the file you are editing and match it.
- **What a screen may draw is the server's answer, not the client's arithmetic.** A space answers `youMay`
  (`own` · `manage` · `log` · `view`), worked out per reader in `SpacesService.mayIn` and asserted against
  `access()` in its spec. Read it with `useMayInSpace` / `useMayManage(spaceId)`; never re-derive a role from an
  owner id and a membership list, and never draw a control that the answer does not reach - **a control somebody
  may not use is absent, not refused after the tap.** Seven critics found the same hole in round 13 because the
  gate asked only "signed in and not the demo".
- **A contract change needs the stack's server rebuilt before anything is looked at.** `docker compose -p
  tcrewrite up --build -d server` takes a minute; without it every screenshot and every agent driving the app is
  reading fields the running image has never heard of, and a screen crashes on the one that is missing.
- **Commit messages**: a short imperative subject, then prose. No bullet lists of the obvious, and **no model,
  tool or assistant identifiers anywhere in the message**.

## The stacks, and how to get back to them

Three compose projects have been in play. All of them are throwaway; `docker compose down --volumes` from the
matching directory frees the disk.

| Project | Where | What |
| --- | --- | --- |
| `tcrewrite` | this worktree | the ordinary test stack; API on 5081, `.env` at the repo root |
| `tcrestore` | `/Users/work/claude/terpcontrol.cloud/migration-test` | a restored copy of the real database; API on 4681 |
| `terpcontrolcloud` | `/Users/work/workspaces/terpcontrol.cloud` | Chris's own stack. **Leave it alone.** |

`tcrestore` is a worktree of this branch with its own `.env`: production secrets so the backup verifies, every
port moved into the 46xx range. It was restored from
`/Users/work/workspaces/terpcontrol.cloud/backup-2026-09-19_17-05-44` with `./restore.sh` from that directory,
which takes about twenty minutes.

**Its database is stopped part way through a migration** — inside `011-entries`, with about 5.4 of 7.7 million
rows carried over and steps 11 to 14 unrecorded. Booting its server would resume the migration. Restore it again
before using it for anything that assumes a clean start.

`./simulate-device.sh` stands in for hardware and the server cannot tell the difference. `--help` lists
everything; `demo-seed` builds a whole account worth looking at.

## What the real database turned out to hold

Measured on the restored copy, and worth knowing before touching the migration again.

| | |
| --- | --- |
| Accounts / devices / pictures | 329 / 295 / 75,253 |
| Device log rows | 7,703,753 |
| …of which one repeated sensor-failure message from 15 devices | 7,283,584 |
| …of which what a grower would call a diary | **744** |
| Alarm rules, of which 15 watch an output rather than a reading | 92 |
| Migrated plans, **all** of which carry no stage on any step | 83 |
| Full migration run, after the index fix and the thinning | ~104 s |

The repeated message was a firmware bug — an inverted latch wrote a line every couple of seconds for as long as
the sensor stayed broken. Fixed in the fridge. **The dryer has the identical latch at `dryer.cpp:101` and was
deliberately left alone**, because `AGENTS.md` says not to build, roll out or test that hardware type and an
unbuildable fix is not worth making. That one is waiting on Chris.

## Things that will bite

- **Two Jest suites, one cache.** The unit and integration configs compile the same sources with different
  module settings. They now have separate cache directories; without that, running them at once produces a
  syntax error in a file that compiles perfectly on its own.
- **The shared contract is a linked package.** `server/node_modules/@fg2/shared-types` is a symlink to
  `../../../shared-types`. An agent working in a scratchpad copy once repointed it and silently broke everyone
  else's typecheck. If a check looks inexplicably wrong, look at that link first.
- **CI installs the contract separately.** Node resolves a linked package's own imports from the package, so CI
  never installed its `zod` and the contract silently degraded to `any`. `.github/workflows/build.yml` and
  `server/Dockerfile` install it, and `server/test/unit/contract-is-typed.spec.ts` fails to compile if it ever
  degrades again.
- **A migration CLI run must build its indexes first.** Without them every upsert is a collection scan and the
  run is quadratic: one lookup against the 7.7 million row collection measured 15.7 seconds. `users` and
  `devices` are the exception and are indexed after the rename, because they hold the old shapes until then.
- **A chart is not finished until it states a number.** Round 12's Charts view drew correct curves with no axis, no
  cursor and no readout, and looked right in a screenshot; what a grower opens it for is the figure. The Timeline's
  pinned scrub header is the idiom, and both screens now share it.
- **The task list's ids carry the turn a plan step is on.** A plan-step task is
  `plan:<device>:<step>:<the instant the step became active>`. Without the last field the entry that ticked the
  task off answered every later turn of the same step as well, so a looping plan, or one stopped and started
  again, stood waiting and was never asked.
- **There is no rollback any more.** It was removed on Chris's instruction: a backup is the way back, and it
  should be checked restorable before an upgrade rather than on the evening it is needed.
