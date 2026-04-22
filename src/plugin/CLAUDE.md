# CLAUDE.md

## Responsibility Boundary
- This directory owns the OpenCode plugin implementation shipped by this repository.
- It defines plugin entrypoints and plugin-scoped support modules, not external workflow assets.

## Allowed Content
- Plugin entrypoint files
- Plugin-scoped module directories such as `worktree/` and `kdco-primitives/`
- Types and helpers needed directly by the plugin runtime

## Forbidden Content
- Feature specs, task docs, or workflow scripts
- Unrelated applications or alternate plugin experiments
- Generic utilities that are not actually used by the plugin
