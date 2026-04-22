# Target State

*Aligned with spec.md, 2026-04-15.*

## Feature Goal

Add workspace-level worktree orchestration across multiple repos via `/dev
<name>` slash command and equivalent `worktree_workspace_create` AI tool, while
preserving existing single-repo behavior.

## Target Behavior

- `/dev <name>` auto-detects git repos among the direct subdirectories of
  `<cwd>` and creates a mirrored worktree layout under
  `<cwd>/../worktrees/<name>/`.
- Each repo is checked out to `dev_{base_branch}_{name}_{YYMMDD}` on first
  creation. `/` in `base_branch` is replaced by `-`; detached HEAD uses
  abbreviated SHA. The stored branch name is reused verbatim on subsequent runs.
- Per-repo reconciliation status: `created`, `reused`, `retried`, `failed`.
- A worktree is **healthy** when: dir exists + `.git` entry + listed in
  `git worktree list` (FR-022). Otherwise it needs retry.
- Orphan worktrees (dir on disk, no DB record) are removed and recreated
  (FR-007).
- Branch collision detection runs as a **pre-check phase** before any
  mutations (FR-009). Any collision rejects the entire command.
- Mutation ordering (FR-023): pre-check → worktrees+sync+hooks → session
  fork → member writes (only after fork succeeds).
- The command forks exactly one workspace-level session and returns it. No
  terminal is spawned. No auto-commit or auto-push.
- Existing valid workspace session is reused; stale or missing binding causes
  a refork.
- A repo previously in the workspace but now absent from `<cwd>` is skipped
  silently.
- Per-repo failures do not block other repos except for branch collisions.
- Ghost worktree metadata is auto-pruned and retried transparently.

## Target Layout

```text
<cwd>/                        # source directory
├── repoA/
├── repoB/
└── repoC/

<cwd>/../worktrees/<name>/    # mirrored workspace
├── repoA/                    # worktree on dev_main_<name>_YYMMDD
├── repoB/                    # worktree on dev_develop_<name>_YYMMDD
└── repoC/                    # worktree on dev_main_<name>_YYMMDD
```

## Storage Contract

- Legacy single-repo state stays in per-project SQLite databases.
- Workspace association, workspace member, and workspace-session binding are
  also stored in per-project databases keyed by each repo's project ID.
- No global `workspace_registry.sqlite` in MVP.
- Workspace membership is reconstructable from per-project records keyed by
  the workspace `<name>` and target path.

## Out of MVP Scope

- `worktree_workspace_delete`
- `localState.files` / overlay files
- `mismatch` status / branch-baseBranch mismatch semantics
- `--force` mode
- Dirty-worktree guards
- Global `workspace_registry.sqlite`

## Open Gaps

- `repoPath` resolution for non-repo or container paths (applies to legacy
  `worktree_create` only; MVP `/dev` uses auto-detect)
