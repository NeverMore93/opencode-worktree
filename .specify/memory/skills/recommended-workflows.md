# Recommended Skills and Subagents

## Purpose

This file maps common repository tasks to the most effective external skills and
subagent patterns. The shared skill bodies live outside this repository; this
document captures repository-specific guidance only.

## Recommended Skill Usage

- Clarify active feature contracts:
  - use `speckit-clarify`
  - best when storage layout, session semantics, repo identity, or caller
    response contracts are still moving
- Generate or refresh the implementation plan:
  - use `speckit-plan`
  - only after high-impact ambiguities are closed or explicitly deferred
- Generate or refresh executable tasks:
  - use `speckit-tasks`
  - use after `plan.md` reflects the latest accepted decisions
- Validate requirements completeness:
  - use `speckit-checklist`
  - use before implementation and again after major clarifications
- Execute approved work:
  - use `speckit-implement`
  - only after critical checklist gaps are closed
- Update repository governance:
  - use `speckit-constitution`
  - pair with manual template synchronization in `.specify/templates/`

## Recommended Subagent Usage

- `explorer` subagents:
  - best for read-only codebase inspection, path/state audits, and locating
    stale documentation
- parallel explorer split:
  - use `dispatching-parallel-agents` when one thread can inspect current code
    and another can inspect target design artifacts independently
- avoid implementation subagents before design closure:
  - this repository benefits more from parallel analysis than from parallel code
    edits until the storage/session model is finalized

## Repo-Local Notes

- `.agents/skills/` is a lightweight index only; do not vendor shared skill
  content into this repository.
- Use `specs/<feature>/cases/` for feature-specific working decisions.
- Use `.specify/memory/` only for durable repo memory, governance, and stable
  workflow context.
