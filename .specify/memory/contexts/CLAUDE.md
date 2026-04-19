# CLAUDE.md

## Responsibility Boundary
- This directory owns stable repository and architecture reference notes or compatibility pointers that should remain useful across multiple features.
- Files here should explain what the repository is, how it is organized, and where canonical context now lives.

## Allowed Content
- Repository overview and architecture context
- Stable implementation notes that outlive a single feature
- Path, state-model, and operational reference notes that agents may need repeatedly

## Forbidden Content
- Feature-specific task tracking or unresolved decision logs that should live under `specs/<feature>/`
- Source code, templates, or scripts
- Duplicated copies of AGENTS guidance that belong at the repository root
