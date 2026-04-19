# CLAUDE.md

## Responsibility Boundary
- This directory owns the PowerShell implementation of repository SpecKit automation.
- Scripts here should remain reusable workflow primitives rather than feature-specific one-offs.

## Allowed Content
- PowerShell scripts for prerequisite checks, feature setup, plan setup, and context updates
- Shared PowerShell helpers used by those scripts
- Inline comments that explain script inputs and side effects

## Forbidden Content
- Markdown templates or command entrypoints
- Product source code
- Feature-specific business logic that belongs in `src/` or `specs/`
