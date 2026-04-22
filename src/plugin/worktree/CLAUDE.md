# CLAUDE.md

## Responsibility Boundary
- This directory owns worktree-domain modules for lifecycle management, launch/session behavior, persistence, sync behavior, and terminal integration.
- Code here may encode worktree-specific policy, but it should not absorb generic primitives that belong in `kdco-primitives/`.

## Allowed Content
- Modules for the shipped single-repo worktree lifecycle and future incremental workspace orchestration support
- Modules for worktree state, launch context, terminal handling, config parsing, reconcile logic, and workspace orchestration
- Worktree-specific types and helper modules that directly support `worktree.ts`
- Focused submodules that split large worktree behavior by responsibility

## Forbidden Content
- Generic cross-plugin primitives
- Specs, checklists, or command markdown
- Unrelated plugin domains or one-off scripts that are not imported by the worktree plugin
