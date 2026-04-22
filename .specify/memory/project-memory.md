# Project Memory

## Repository Identity

- This repository is a facade for the OCX monorepo implementation of the OpenCode worktree plugin.
- The canonical upstream source lives in the OCX monorepo, not in this facade repository.
- This repository is the right place for local specs, context, and facade-safe code changes, but not for pretending the facade is the canonical source.

## Current Shipped Behavior

- The runtime exposes three tools: `worktree_create`, `worktree_delete`, and `worktree_workspace_create`.
- `worktree_create` supports single-repo mode with `repoPath` and `headless` parameters (FR-005/FR-006/FR-020). Legacy interactive terminal-and-fork path is preserved.
- `worktree_workspace_create` (plus the auto-created `/dev <name>` slash command per FR-024) auto-detects git repos in `<cwd>`, creates a mirrored worktree layout under `<cwd>/../worktrees/<name>/`, runs per-repo sync and hooks in parallel, forks exactly one workspace-level session (always headless), and returns `WorkspaceCreateResult { workspacePath, sessionId, sessionDisposition, repos[], warnings[] }`.
- The worktree path formula for single-repo legacy mode is `${HOME}/.local/share/opencode/worktree/<projectId>/<branch>`. Workspace mode uses `<cwd>/../worktrees/<name>/<repo>/`.
- The plugin-owned SQLite path formula is `${HOME}/.local/share/opencode/plugins/worktree/<projectId>.sqlite`.
- The SQLite tables are:
  - `sessions` and singleton `pending_operations` (legacy single-repo)
  - `workspace_associations` and `workspace_members` (workspace mode, per-project DB; FR-021)
- The state module manages a DB pool keyed by projectId with graceful cleanup on SIGINT/SIGTERM/beforeExit.
- `worktree_delete` is deferred: it records a pending delete and actual cleanup runs on `session.idle` (hooks, snapshot commit, worktree remove, state clear).

## Context Discipline

- `README.md` should keep describing shipped behavior until new features actually land.
- `AGENTS.md` is the primary agent-facing map for current truth, active design state, and canonical references.
- `.specify/memory/` stores stable repo memory.
- `specs/<feature>/context/` stores feature-local implementation truth and target-state references.
- `specs/<feature>/cases/` stores case breakdowns that are more concrete than the spec narrative.

## Active Feature Pointer

- Active feature: `specs/001-workspace-worktree-orchestration/`
- Primary context files:
  - `.specify/memory/active-feature-context.md`
  - `.specify/memory/contexts/repository-context.md`
  - `.specify/memory/contexts/current-vs-target-state.md`
  - `.specify/memory/cases/001-workspace-worktree-orchestration.md`
  - `specs/001-workspace-worktree-orchestration/spec.md`
  - `specs/001-workspace-worktree-orchestration/context/current-state.md`
  - `specs/001-workspace-worktree-orchestration/context/target-state.md`
  - `specs/001-workspace-worktree-orchestration/cases/reconcile-cases.md`
