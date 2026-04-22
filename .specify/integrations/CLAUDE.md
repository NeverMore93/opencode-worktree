# CLAUDE.md

## Responsibility Boundary
- This directory owns host-specific integration layers that connect core SpecKit assets to external tools.
- It should stay thin and adapter-oriented.

## Allowed Content
- Tool-specific integration folders
- Adapter notes that explain how a host consumes `.specify/`
- Small installer or bridge assets that are specific to one host

## Forbidden Content
- Core workflow templates or shared scripts
- Feature specs or repository source code
- Host-agnostic logic that belongs higher in `.specify/`
