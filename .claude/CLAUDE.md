# CLAUDE.md

## Responsibility Boundary
- This directory owns Claude Code integration assets for this repository.
- It exists to expose repo workflows to Claude-facing command entrypoints, not to store general project documentation.

## Allowed Content
- Claude command definitions
- Minimal Claude-specific integration notes that explain command usage
- Subdirectories dedicated to Claude integration concerns

## Forbidden Content
- Source code, SpecKit templates, or PowerShell automation
- Feature specs and design artifacts
- Duplicated command logic that belongs in `.specify/`
