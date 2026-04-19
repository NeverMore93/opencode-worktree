# Active Feature Context

## Scope

- Active feature: `001-workspace-worktree-orchestration`
- Goal: add workspace-level worktree orchestration across multiple repos while preserving existing single-repo behavior.
- Triggering surface: `/dev <name>` slash command and equivalent `worktree_workspace_create` AI tool.

## Ratified Decisions (aligned with spec.md, 2026-04-15)

- `/dev <name>` is always headless: it forks a session and returns `sessionId`; the caller decides how to launch or connect.
- Repos are auto-detected by scanning direct subdirectories of `<cwd>` for git repositories. No explicit repos list. Submodules are not recursed into.
- Target workspace path is `<cwd>/../worktrees/<name>/`.
- Name validation: `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`.
- Branch name on first creation: `dev_{base_branch}_{name}_{YYMMDD}`. `/` in `base_branch` replaced by `-`; detached HEAD uses abbreviated SHA (8 chars). Stored on first create; reused verbatim on re-run (no date re-rolling). Manually deleted branches are recreated via `-b`.
- Per-repo reconciliation on re-run: healthy -> `reused`, missing -> `created`, previously failed -> `retried`, failure during current run -> `failed`.
- Per-repo status set: `{created, reused, retried, failed}`. No `mismatch` status in MVP.
- A workspace member worktree is **healthy** when: (a) dir exists, (b) `.git` entry present, (c) `git worktree list` includes the path (FR-022).
- Orphan worktrees (dir exists but no DB record) are removed and recreated as `retried` (FR-007).
- Branch collision detection is a **pre-check phase** before any mutations (FR-009). If any collision, entire command rejected.
- Mutation ordering (FR-023): pre-check → worktrees+sync+hooks → session fork → member writes (only after fork succeeds).
- Exactly one workspace-level session is forked per workspace. Existing valid session is reused; stale or missing binding causes a refork.
- Per-repo sessions are never auto-created during workspace creation.
- State is persisted in per-project databases keyed by each repo's project ID. No global `workspace_registry.sqlite` in MVP.
- Workspace membership is reconstructable from per-project records keyed by workspace `<name>` and target path.
- The command does not spawn a terminal, does not auto-commit, and does not auto-push.
- Ghost worktree metadata is auto-pruned and retried transparently.
- Single-repo `worktree_create` contract (including terminal spawn when `headless = false`) is preserved unchanged.
- A repo previously in the workspace but now absent from `<cwd>` is skipped silently.
- Response includes `error?: string` on per-repo objects when `status = "failed"`.

## Explicitly Out of MVP Scope

- `worktree_workspace_delete` — removed from MVP; users manually clean up via `rm` + `git worktree prune`.
- `localState.files` / overlay files — removed from MVP.
- `mismatch` status / branch-baseBranch mismatch semantics — removed from MVP.
- `--force` mode — removed from MVP.
- Dirty-worktree guards — removed from MVP.
- Global `workspace_registry.sqlite` — removed from MVP.

## Unresolved Items

- How should `worktree_create.repoPath` resolve when the input path is not itself a git repo root? (Applies to legacy single-repo tool only; MVP `/dev` uses auto-detect.)
