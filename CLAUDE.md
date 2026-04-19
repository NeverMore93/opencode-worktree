# CLAUDE.md

## Responsibility Boundary
- This repository owns the facade implementation, stable project memory, SpecKit assets, feature specifications, and repo-local agent guidance for the OpenCode worktree plugin.
- Child directories may narrow these rules with their own `CLAUDE.md`; the nearest file wins for its subtree.

## Allowed Content
- Plugin source code under `src/`
- Specification workflow assets under `.specify/`, including stable memory under `.specify/memory/`
- Agent workflow assets under `.claude/` and `.agents/`, including lightweight repo-local skills
- Feature specs, plans, tasks, checklists, context, and case breakdowns under `specs/`
- Minimal top-level documentation such as `README.md`, `AGENTS.md`, and this file

## Forbidden Content
- Generated build outputs, vendored dependencies, secrets, or local machine state
- Unrelated applications, experiments, or copied OCX monorepo code that is not maintained here
- Files placed in a directory whose ownership belongs to a more specific child contract
