# CLAUDE.md

## Responsibility Boundary
- This directory owns cross-feature case indexes and compatibility pointers for design and decision threads.
- Feature-local case source-of-truth documents should live under `specs/<feature>/cases/`.

## Allowed Content
- Per-decision markdown indexes or compatibility pointers
- Decision summaries that link back to specs, plans, or source files
- Explicit lists of accepted decisions, working recommendations, and open questions when they are not tied to one feature-local canonical file

## Forbidden Content
- Stable repository reference material that belongs under `contexts/`
- Source code, scripts, or generated artifacts
- New feature-local case source-of-truth content that should live under `specs/<feature>/cases/`
- Duplicate copies of full feature specs, plans, or tasks
