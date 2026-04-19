# Active Feature Context

## Scope

- Active feature: `001-workspace-worktree-orchestration`
- Goal: add workspace-level worktree orchestration across multiple repos while preserving existing single-repo behavior.
- Triggering surface: `/dev <name>` slash command and equivalent `worktree_workspace_create` AI tool.

## Ratified Decisions (aligned with spec.md, 2026-04-17)

- `/dev <name>` is always headless: it forks a session and returns `sessionId`; the caller decides how to launch or connect.
- `/dev` slash command is provided by an auto-created `.opencode/commands/dev.md` markdown file (FR-024, `ensureDevCommand`). OpenCode's native command scan registers it alongside built-ins. The markdown body uses `$ARGUMENTS` to invoke the `worktree_workspace_create` AI tool; both surfaces are MVP-equivalent.
- Repos are auto-detected by scanning direct subdirectories of `<cwd>` for git repositories. No explicit repos list. Submodules are not recursed into.
- Target workspace path is `<cwd>/../worktrees/<name>/`.
- Name validation: `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`, plus namespace conflict check against OpenCode built-ins (`init`, `review`) and existing `.opencode/commands/<name>.md` files (excluding the auto-created `dev.md`).
- Branch name on first creation: `dev_{base_branch}_{name}_{YYMMDD}`. `base_branch` is the local short HEAD name (`git rev-parse --abbrev-ref HEAD`) preserved as-is — slashes in names like `feature/login` are NOT substituted (the iteration-2 `/`→`-` rule was removed in spec Part 3). Detached HEAD uses SHA[:12] (extended from SHA[:8] in Part 3 for collision resistance). Stored on first create; reused verbatim on re-run (no date re-rolling). Manually deleted branches are recreated via `-b`.
- Per-repo reconciliation on re-run: healthy -> `reused`, missing -> `created`, previously failed -> `retried`, failure during current run -> `failed`.
- Per-repo status set: `{created, reused, retried, failed}`. No `mismatch` status in MVP.
- A workspace member worktree is **healthy** when: (a) dir exists, (b) `.git` entry present, (c) `git worktree list` includes the path (FR-022).
- Orphan worktrees (dir exists but no DB record) are removed and recreated as `retried` (FR-007).
- Branch collision detection is a **dual-path pre-check** before any mutations (FR-009): (a) confirmed branch collision (target branch already checked out at a live worktree outside the workspace) rejects the entire command; (b) pre-check failure on a single repo (git worktree list errors, lock held, transient I/O) marks that repo `status="failed"` while other repos continue. Whole-command reject is reserved exclusively for case (a).
- Mutation ordering (FR-023): pre-check → worktrees+sync+hooks → session fork → member writes (only after fork succeeds; only for successful repos in the partial-success case).
- Exactly one workspace-level session is forked per workspace. Existing valid session is reused; stale or missing binding causes a refork.
- Per-repo sessions are never auto-created during workspace creation.
- State is persisted in per-project databases keyed by each repo's project ID. No global `workspace_registry.sqlite` in MVP.
- Workspace membership is reconstructable from per-project records keyed by workspace `<name>` and target path.
- The command does not spawn a terminal, does not auto-commit, and does not auto-push.
- Ghost worktree metadata is auto-pruned and retried transparently.
- Single-repo `worktree_create` contract (including terminal spawn when `headless = false`) is preserved unchanged.
- A repo previously in the workspace but now absent from `<cwd>` is skipped silently.
- Response `error?: string` field MUST be present whenever `status = "failed"`, with a human-readable failure reason (FR-019).

## Explicitly Out of MVP Scope

- `worktree_workspace_delete` — removed from MVP; users manually clean up via `rm` + `git worktree prune`.
- `localState.files` / overlay files — removed from MVP.
- `mismatch` status / branch-baseBranch mismatch semantics — removed from MVP.
- `--force` mode — removed from MVP.
- Dirty-worktree guards — removed from MVP.
- Global `workspace_registry.sqlite` — removed from MVP.

## Unresolved Items

- How should `worktree_create.repoPath` resolve when the input path is not itself a git repo root? (Applies to legacy single-repo tool only; MVP `/dev` uses auto-detect.)
