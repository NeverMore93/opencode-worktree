# Project Skill Map

## Source Of Truth

- User-scoped Codex skills under `$CODEX_HOME/skills` are the source of truth
  for Speckit workflows.
- Repo-local `.agents/skills/` content in this repository is intentionally
  lightweight and should stay index-like rather than duplicating full skill
  bodies.
- The repo-local wrapper skill
  `.agents/skills/workspace-worktree-context/SKILL.md` is the canonical entry
  point for loading workspace-orchestration context quickly.

## Recommended Skills By Phase

### Clarification And Gap Detection

- `speckit-clarify`
- `speckit-checklist`
- `speckit-analyze`

Use these before implementation whenever behavior, state ownership, or cleanup
semantics are still unclear.

### Design And Writing

- `speckit-plan`
- `doc-coauthoring`
- `dispatching-parallel-agents`

Use these when turning a clarified spec into durable design artifacts and when
parallel read-only analysis can reduce ambiguity.

### Governance

- `speckit-constitution`

Use this whenever repository-level principles, templates, or durable memory
rules need to change.

### Implementation

- `speckit-implement`

Use only after critical checklist gaps are closed or the user explicitly accepts
implementation risk.

## Repo-Specific Cautions

- Do not copy the full text of user-scoped Speckit skills into this repository.
- Do not treat generated agent-context files as authoritative over curated root
  `AGENTS.md` and local `CLAUDE.md` contracts.
- Put feature-local cases under `specs/<feature>/cases/`, not under
  `.specify/memory/`.
