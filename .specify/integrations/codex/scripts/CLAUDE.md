# CLAUDE.md

## Responsibility Boundary
- This directory owns Codex-specific scripts that install or refresh SpecKit integration state.
- Scripts here should stay operational and host-specific.

## Allowed Content
- Codex install/update scripts
- Small helper logic used only by those scripts
- Script comments that document inputs, side effects, and expected host behavior

## Forbidden Content
- Generic workflow logic shared by all hosts
- Templates, specs, or command markdown
- Product runtime code or repository business logic
