# CLAUDE.md

## Responsibility Boundary
- This directory owns the repo-local wrapper skill for the workspace-worktree design thread.
- It should point agents to canonical repository memory and feature artifacts without duplicating the full design corpus.

## Allowed Content
- `SKILL.md` and lightweight helper notes that explain how to load the right context
- Minimal metadata that keeps the wrapper skill aligned with current repository memory
- References to canonical files under `.specify/memory/` and `specs/`

## Forbidden Content
- Full copies of shared skill bodies or large duplicated design documents
- Source code or implementation scripts
- Feature specs, plans, or tasks copied out of their canonical locations
