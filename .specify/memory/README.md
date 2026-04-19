# SpecKit Memory

This directory stores long-lived repository memory that should survive beyond a
single chat session or a single feature artifact.

## Canonical Files

- `constitution.md` — repository-wide governance for design, documentation, and
  stateful plugin changes
- `project-memory.md` — stable repository truths and durable operating context
- `active-feature-context.md` — current feature decisions, recommendations, and
  unresolved items

## Supporting Compatibility Layers

- `project-context.md` — compatibility pointer for older references
- `contexts/` — repo-wide reference notes or compatibility pointers
- `cases/` — compatibility pointers or cross-feature decision indexes
- `skills/` — repo-local workflow and skill-selection notes

## Placement Rules

- Put enduring repository knowledge in `project-memory.md`.
- Put active feature decisions in `active-feature-context.md`.
- Put feature-local context and case breakdowns under `specs/<feature>/`.
- Keep compatibility files short and point them at canonical locations instead
  of duplicating large design documents.
