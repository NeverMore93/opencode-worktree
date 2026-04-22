# CLAUDE.md

## Responsibility Boundary
- This directory owns the Codex-specific integration layer for SpecKit in this repository.
- It should only capture Codex-facing adaptation details, not generic SpecKit behavior.

## Allowed Content
- Codex integration notes
- Codex-specific helper subdirectories
- Assets needed to install or update Codex-facing workflow context

## Forbidden Content
- Claude-specific command definitions
- Shared SpecKit templates or generic scripts
- Product plugin source code or feature specs
