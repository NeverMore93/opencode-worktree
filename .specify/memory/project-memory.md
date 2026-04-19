# Project Memory

## Repository Identity

- This repository is a facade for the OCX monorepo implementation of the OpenCode worktree plugin.
- The canonical upstream source lives in the OCX monorepo, not in this facade repository.
- This repository is the right place for local specs, context, and facade-safe code changes, but not for pretending the facade is the canonical source.

## Current Shipped Behavior

- The current runtime exposes only `worktree_create` and `worktree_delete`.
- `worktree_create` currently assumes a single repo rooted at `ctx.directory`.
- The current worktree path formula is `${HOME}/.local/share/opencode/worktree/<projectId>/<branch>`.
- The current plugin-owned SQLite path formula is `${HOME}/.local/share/opencode/plugins/worktree/<projectId>.sqlite`.
- The current SQLite tables are:
  - `sessions`
  - singleton `pending_operations`
- `worktree_delete` is deferred:
  - it first records a pending delete
  - actual cleanup runs on `session.idle`
  - cleanup runs hooks, commits a snapshot, removes the worktree, and clears plugin state

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
