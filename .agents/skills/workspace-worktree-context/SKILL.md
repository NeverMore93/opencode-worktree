---
name: workspace-worktree-context
description: Use when working on the opencode-worktree workspace orchestration feature in this repository and you need the current code truth, ratified design decisions, or canonical context files before editing specs or implementation.
---

# Workspace Worktree Context

## Overview

This is a repo-local wrapper skill. It does not restate the design in full; it points to the canonical files that separate current implementation truth from planned workspace orchestration behavior.

## Read First

- `AGENTS.md`
- `.specify/memory/constitution.md`
- `.specify/memory/project-memory.md`
- `.specify/memory/project-context.md`
- `.specify/memory/active-feature-context.md`
- `.specify/memory/contexts/current-vs-target-state.md`
- `.specify/memory/cases/workspace-metadata-authority.md`
- `.specify/memory/cases/repo-path-resolution.md`
- `specs/001-workspace-worktree-orchestration/spec.md`
- `specs/001-workspace-worktree-orchestration/context/current-state.md`
- `specs/001-workspace-worktree-orchestration/context/target-state.md`
- `specs/001-workspace-worktree-orchestration/cases/reconcile-cases.md`

## Non-Negotiables

- Keep current shipped behavior and target feature behavior separate.
- Preserve legacy single-repo behavior unless the spec explicitly changes it.
- Do not silently resolve open storage or lifecycle questions; either follow the ratified decision or record a clarification.
