<!--
Sync Impact Report
Version change: template -> 1.0.0
Modified principles: initial adoption
Added sections: Repository Constraints; Workflow and Review Gates
Removed sections: none
Templates requiring updates:
- ✅ `E:/workspaces/opencode-worktree/.specify/templates/spec-template.md` remains compatible with explicit requirements, assumptions, and edge-case capture.
- ✅ `E:/workspaces/opencode-worktree/.specify/templates/plan-template.md` remains compatible with Constitution Check usage.
- ✅ `E:/workspaces/opencode-worktree/.specify/templates/tasks-template.md` remains compatible with doc and cross-cutting task requirements.
- ✅ `E:/workspaces/opencode-worktree/AGENTS.md` updated in the same change to reflect current-vs-target behavior and canonical context files.
Follow-up TODOs:
- Clarify non-git or container `repoPath` resolution before implementation begins.
-->
# opencode-worktree Constitution

## Core Principles

### I. Facade Fidelity
- This repository MUST distinguish between current shipped behavior and planned feature work.
- Documentation, agent guidance, and context files MUST point back to the OCX canonical source when describing maintained code.
- User-facing docs MUST NOT advertise unimplemented workspace-orchestration behavior as already shipped.

### II. Spec-Driven Change Control
- Material behavior changes MUST start in a feature spec under `specs/` and move through clarify, checklist, plan, and tasks before implementation.
- High-risk ambiguities in caller-visible behavior, persistence, or lifecycle ownership MUST be resolved or explicitly recorded as open before code changes begin.
- Maintained guidance files MUST stay aligned with the active spec set in the same change that alters the design.

### III. Additive Compatibility
- Existing single-repo `worktree_create` and `worktree_delete` behavior MUST remain intact unless a spec explicitly changes it.
- Workspace orchestration features MUST be additive and MUST keep single-repo headless behavior distinct from workspace headless behavior.
- Backward-compatible behavior preservation MUST be visible in specs, plans, tasks, and agent-facing guidance.

### IV. Explicit State Ownership
- Managed worktrees or workspaces MUST be identified by plugin-managed metadata, not by directory shape alone.
- Session bindings, workspace members, cleanup state, and `localState.files` behavior MUST each have one explicit owner and one authoritative contract.
- Local-only behavior MUST be opt-in via config; filename-based inference is forbidden.

### V. Directory Contract Hygiene
- Every maintainable directory added to the repository MUST either intentionally inherit an existing `CLAUDE.md` or add a closer one.
- Stable project memory belongs under `.specify/memory/`; feature-local context and case breakdowns belong under `specs/<feature>/`.
- Repo-local skills MUST stay lightweight and point to canonical context rather than duplicate large design documents.

## Repository Constraints

- This repository is a facade for the OCX monorepo implementation. Shipped code lives under `src/plugin/`; the full build and test workflow lives upstream.
- Current runtime behavior includes both the legacy single-repo plugin (`worktree_create`, `worktree_delete`) and multi-repo workspace orchestration (`worktree_workspace_create`, the auto-created `/dev <name>` slash command), all implemented in `src/plugin/worktree.ts` plus `src/plugin/worktree/`.
- Active feature work MUST update this constitution alongside the relevant spec change; behaviour claims here are the pre-feature baseline only when explicitly labelled as such.

## Workflow and Review Gates

- Before implementation, agents MUST refresh themselves on `AGENTS.md`, `.specify/memory/*.md`, and the active feature's `spec.md`, `context/`, and `cases/` files.
- Design updates that introduce or resolve major persistence or lifecycle decisions MUST be reflected in the corresponding memory and context files in the same change.
- Completion claims MUST include a consistency check between current code behavior, active spec decisions, and agent-facing guidance.

## Governance

- This constitution supersedes ad hoc repo notes when they conflict.
- Amendments MUST update this file and any impacted `AGENTS.md`, `CLAUDE.md`, memory, context, case, or repo-local skill files in the same change.
- Versioning follows semantic versioning for governance: MAJOR for incompatible principle changes, MINOR for new or materially expanded principles or sections, PATCH for clarifications only.
- Compliance review for feature work MUST check both repository code truth and specification truth before merge or handoff.

**Version**: 1.0.0 | **Ratified**: 2026-04-14 | **Last Amended**: 2026-04-14
