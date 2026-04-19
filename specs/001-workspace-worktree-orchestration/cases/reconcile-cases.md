# Reconcile Cases

*Aligned with spec.md, 2026-04-15.*

## Healthy Worktree Definition (FR-022)

A workspace member worktree is **healthy** when all of the following hold:
1. The worktree directory exists on disk.
2. The directory contains a `.git` file or directory.
3. The repo's `git worktree list` output includes the worktree path.

If any condition fails, the member is classified as needing retry (`retried`),
not reuse.

## Requested Member Outcomes

- healthy existing requested member -> `reused`
- missing requested member (or directory deleted) -> `created` or `retried`
- previously failed requested member -> `retried`
- orphan worktree (dir exists on disk but no DB record, e.g., after FR-015
  fork failure) -> remove orphan dir, recreate -> `retried`
- reconcile failure during current run -> `failed`
- ghost worktree metadata (dir removed, stale `.git/worktrees`) -> auto-prune + retry -> `retried`

Note: `mismatch` status was removed from MVP scope.

## Branch Name Computation

- First creation: `dev_{base_branch}_{name}_{YYMMDD}`
- `base_branch` is the local short HEAD name from `git rev-parse --abbrev-ref HEAD`, preserved as-is. Slashes in names like `feature/login` are NOT substituted — the iteration-2 `/`→`-` rule was removed in spec Part 3 (2026-04-17).
- Detached HEAD: `base_branch` = first 12 hex characters of commit SHA (extended from 8 chars in spec Part 3 for collision resistance in large monorepos).
- Stored branch name is reused verbatim on re-run; date does not re-roll.
- If stored branch was manually deleted: recreated via `git worktree add -b`.

## Session Outcomes

- valid existing workspace session binding -> `sessionDisposition = reused`
- missing or stale workspace session binding -> fork a new workspace session and
  return `sessionDisposition = forked`

## Mutation Ordering (FR-023)

1. Pre-check for branch collisions (FR-009) — before any mutations
2. Create/reconcile all worktrees + run sync/hooks in parallel across repos
3. Fork or reuse workspace session
4. Write WorkspaceMember records to per-project databases (only after session
   fork succeeds; if fork fails, no records are written per FR-015)

## Whole-Command Rejection (FR-009)

- A **pre-check phase** runs before any `git worktree add`: for every repo,
  verify the target branch is not already checked out by a live worktree at a
  path outside the target workspace.
- If any collision is detected during pre-check, the entire command is rejected.
  No worktrees are created for any repo. The error names the conflicting repo,
  branch, and external worktree path.

## Scope Rules

- `/dev <name>` (and `worktree_workspace_create`) is prepare/reconcile only.
- It does not spawn a terminal.
- It does not auto-commit.
- It does not auto-push.
- A repo previously in the workspace but now absent from `<cwd>` is skipped
  silently and does not appear in the response.
- A new repo appearing in `<cwd>` since the last run is created fresh with
  today's date in its branch name.

## Related Cases

- `workspace-metadata-authority.md` — superseded by spec Part 2 (per-project DB only)
- `repo-path-resolution.md` — open, but only relevant to legacy `worktree_create`
