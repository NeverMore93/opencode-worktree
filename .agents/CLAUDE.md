# CLAUDE.md

## Responsibility Boundary
- This directory owns repo-local agent integration assets and skill exposure points.
- It defines how this repository references or surfaces agent skills; it does not own product behavior.

## Allowed Content
- Skill index directories and lightweight repo-local skill wiring
- Notes that explain how repository workflows and canonical context files are exposed to agents
- Minimal metadata needed to keep repo-local agent entrypoints organized

## Forbidden Content
- Plugin source code, runtime scripts, or feature implementation logic
- Feature specs, plans, or checklists that belong under `specs/`
- Duplicated copies of shared skill content when a higher-level source of truth already exists
