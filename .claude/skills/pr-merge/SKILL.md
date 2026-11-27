---
name: pr-merge
description: Takes one pull request all the way to master - addresses its open review comments, brings master in and resolves the conflicts, watches CI and fixes what fails, and once everything is green squash-merges it with the admin bypass of the one-review rule. Chris's replacement for GitHub's auto-merge, which the branch rule switches off. Trigger via `/pr-merge [<pr-number>]`; without a number, the PR of the checked-out branch.
when_to_use: Chris asks to merge a PR, to "finish", "land" or "auto-merge" it, or calls /pr-merge. Never on an agent's own initiative - invoking the skill is the authorisation to merge, and it covers only the PR it names.
---

# Merge a pull request

Chris is the only developer. The branch rule on `master` asks for one approving review so that nobody else can
merge, which also takes away GitHub's auto-merge button. This skill does what that button would: it merges the
PR `$ARGUMENTS` once it is green - and before that does the work that keeps it from being green.

Calling the skill is Chris's word for this one merge ([development workflow](../../../docs/knowledge/development-workflow.md#branches-and-pushing)).
It never extends to another PR, and it never merges past something that is not green.

## 0. The PR and the checkout

1. Resolve the PR: the number in `$ARGUMENTS`, else `gh pr view --json number` on the current branch. Read
   `gh pr view <N> --json number,title,state,isDraft,headRefName,baseRefName,headRefOid,mergeable,mergeStateStatus,author`.
   Stop if it is not open or its base is not `master`.
2. Work on the PR's own branch. If the current checkout is on `headRefName` and its tree is clean, use it; with a
   dirty tree ask before doing anything. Otherwise make a worktree from the fetched branch
   (`git fetch origin <head> && git worktree add .claude/worktrees/merge-<N> origin/<head>`, then
   `git switch -c <head> --track origin/<head>` inside it unless the branch is checked out elsewhere - then work on
   a detached HEAD and push with `git push origin HEAD:<head>`). A fresh worktree needs `npm ci` in every subproject
   it checks (`docs/knowledge/development-workflow.md`, Worktrees).
3. A draft is made ready (`gh pr ready <N>`) - asking to merge it says it is done.

## 1. Review comments

Requests come as review comments and are never delivered to the session, so read all of them:

```sh
gh api --paginate 'repos/{owner}/{repo}/pulls/<N>/comments'    # inline review comments
gh api --paginate 'repos/{owner}/{repo}/issues/<N>/comments'   # the conversation
gh api --paginate 'repos/{owner}/{repo}/pulls/<N>/reviews'     # review bodies
```

and the threads with their state:

```sh
gh api graphql -F owner='{owner}' -F repo='{repo}' -F n=<N> -f query='
  query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){
    reviewThreads(first:100){nodes{id isResolved comments(first:50){nodes{databaseId author{login} body path line}}}}}}}'
```

Open is: an unresolved thread, a review body with a request in it, a conversation comment no later comment answers.
Bot comments (CI summaries) and Claude's own replies are not requests. Each open one is a requirement:

- **A change asked for** - make it on the branch, run that subproject's checks, commit (a commit per comment or per
  theme, written for master's history, `docs/knowledge/development-workflow.md`, Commits), then answer in the
  thread what changed and with which commit, and resolve the thread
  (`gh api graphql -f query='mutation{resolveReviewThread(input:{threadId:"<id>"}){thread{isResolved}}}'`).
- **A question** - answer it in the thread; resolve it only when the answer needs no change.
- **A request that needs Chris's decision, is unclear, or that you think is wrong** - do not guess and do not merge.
  Answer in the thread with what is unclear and a recommendation, and stop at the end with the report (step 6).

Knowledge that comes up in a comment is recorded with the `remember` skill, in the same PR.

A review Chris has not submitted yet is invisible to the API. That is his to submit; it is not waited for.

## 2. Master in, conflicts out

```sh
git fetch origin master
git merge-base --is-ancestor origin/master HEAD || echo behind
```

Behind, or `mergeable` is `CONFLICTING`: bring master in **by merge**, never by rebase - pushed history is not
rewritten without Chris's word, and the squash merge flattens the merge commit anyway. In a desktop-app worktree,
the `sync_with_base_branch` tool does the merge on the host; elsewhere `git merge origin/master`. Resolve each
conflict keeping both sides' intent: a change master made to code the branch replaced is ported into the
replacement; the generated contract (`shared-types/`) and lock files are regenerated, never merged by hand; i18n
catalogues are merged as JSON (`docs/knowledge/development-workflow.md`, Merging their work). If master changed a
`package-lock.json`, `npm ci` before any check is believed.

Being up to date is not required for the merge itself, but CI must have run on what lands, so a branch that is
behind is brought up to date before the CI run that counts.

## 3. Checks before the push

Run the lint, build and test steps the README's Development section lists for every subproject the branch touches
(`git diff --name-only origin/master...HEAD`), plus `node scripts/check-docs.mjs` when `docs/` changed. Read their
output in its own command. Then push - a fast-forward of the PR branch, `git push origin <head>` (or
`HEAD:<head>`). The push guard may send you back once; do what it says.

## 4. Watch CI

Note the head SHA you pushed. Wait for its checks with one blocking command in the background, not a poll loop:

```sh
gh pr checks <N> --watch --fail-fast --interval 30
```

Checks can take a minute to appear after a push; if the command says there are none, wait and run it again once.
Its exit code says it all: 0 green, 8 still pending, anything else a failure.

**A check failed** - hand the log to a Haiku subagent (`Agent`, `model: "haiku"`), because a failed job's log is
long and only a few lines of it matter:

> Run `gh run view <run-id> --log-failed` in `<checkout>` (the run id is in the check's link from
> `gh pr checks <N> --json name,state,link`). Report in at most 15 lines: which job and step failed, the error
> messages verbatim, and the file, line and test name each points at. No fixes, no speculation.

Fix the cause on the branch, run the checks from step 3, push, and watch again. A failure that is not the
branch's - a flaky test, a registry outage, a check failing on master too (`gh run list --branch master -L 3`) - is
re-run once (`gh run rerun <run-id> --failed`); a second failure is reported, not merged past.

After three rounds of fixing CI, stop and report.

## 5. Merge

Right before merging, check again - each of these sends you back to the step named:

- review comments or threads newer than step 1 (step 1),
- `headRefOid` is not the SHA CI ran on (step 4),
- `gh pr checks <N> --json name,bucket`: anything `fail` or `pending` (step 4); `skipping` is fine,
- `mergeable` is `CONFLICTING` (step 2).

Then:

```sh
gh pr merge <N> --squash --admin --match-head-commit <sha>
```

`--admin` bypasses the review rule and nothing else may be bypassed with it: the checks are already green.
`--match-head-commit` refuses if somebody pushed in between. The squash takes GitHub's default subject (the PR title
and number) and body (the branch's commit messages), which is how master's history is written
(`docs/knowledge/development-workflow.md`, Commits). The repository does not delete merged branches, so delete it:
`git push origin --delete <head>` - and, if this skill made a worktree for the merge, remove it.

## 6. Report

Lead with the outcome: merged as `<sha>` on master, or not merged and why. Then, briefly: each review comment and
what was done about it, the conflicts and how they were resolved, the CI failures and their fixes, and what was
left for Chris. Never report a merge the `gh pr merge` output did not confirm.

## Never

- merge a PR other than the one named, or with a check failing or pending, or with a review request unanswered;
- rebase or force-push the PR branch;
- use `--admin` for anything but the review rule;
- wait on a review Chris has not submitted, or ask somebody else to approve.
