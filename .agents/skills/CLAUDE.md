# CLAUDE.md

## Responsibility Boundary
- This directory groups the skill names this repository chooses to surface for agents.
- Child skill directories inherit this contract unless they later gain their own `CLAUDE.md`.

## Allowed Content
- Per-skill directories containing `SKILL.md` and optional lightweight supporting notes
- Repo-local wrappers, links, or lightweight metadata that point to canonical context
- Skill indexes or README files that map repo workflows to external or user-scoped skills
- Naming that matches the workflow commands used in this repository

## Forbidden Content
- Product source code or runtime helpers
- Feature-specific specs or implementation notes
- Large duplicated design documents that should stay canonical elsewhere
- Shared skill libraries copied here without a clear repo-local reason
