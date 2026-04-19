# CLAUDE.md

## Responsibility Boundary
- This directory defines the Claude slash-command surfaces used by the repository workflows.
- Each file should describe one command contract and point to the shared workflow assets rather than redefining repository behavior.

## Allowed Content
- `speckit.*.md` command entrypoints
- Command-specific invocation guidance tied to this repository
- Minimal references to `.specify/` templates and scripts

## Forbidden Content
- General project docs or feature specifications
- Runtime scripts or implementation code
- Large copies of template content that should stay canonical under `.specify/templates/`
