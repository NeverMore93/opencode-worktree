# CLAUDE.md

## Responsibility Boundary
- This directory owns small reusable primitives shared across kdco registry plugins.
- Code here should stay generic, low-level, and free of worktree-specific orchestration policy.

## Allowed Content
- Generic helpers for shell escaping, terminal detection, mutexes, timeouts, temp paths, and shared plugin types
- Small index/export wiring for those primitives
- Narrow utility modules that can be reused by multiple plugins

## Forbidden Content
- Worktree business rules, session orchestration, or tool contracts
- Feature-specific state models
- High-level workflows that belong under `src/plugin/worktree/`
