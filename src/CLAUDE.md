# CLAUDE.md

## Responsibility Boundary
- This directory owns repository source code only.
- Everything under `src/` should contribute directly to the maintained plugin implementation surface.

## Allowed Content
- TypeScript source files and source-only module directories
- Small code-local documentation that explains module responsibilities
- Shared source abstractions used by the plugin

## Forbidden Content
- Specs, plans, checklists, or command markdown
- Generated code, build artifacts, or local scratch files
- Tooling assets that belong under `.specify/` or `.claude/`
