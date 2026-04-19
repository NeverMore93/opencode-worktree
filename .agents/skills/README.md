# Repo-Local Skill Surface

This repository does not vendor the actual Speckit or shared skill bodies under
`.agents/skills/`. The directories here exist only to preserve naming parity
with repo workflows and to make the intended skill surface easy to inspect.

## Current Guidance

- Prefer user-scoped Speckit skills for specification, planning, task
  generation, checklisting, clarification, and implementation.
- Treat the directories under `.agents/skills/` as lightweight placeholders or
  exposure points, not as the source of truth for skill content.
- For repository-specific workflow guidance, read:
  - `E:/workspaces/opencode-worktree/.specify/memory/skills/project-skill-map.md`
  - `E:/workspaces/opencode-worktree/.agents/skills/workspace-worktree-context/SKILL.md`

## Current Preferred Combinations

- Design clarification:
  - `speckit-clarify` + read-only `explorer` subagents
- Parallel analysis:
  - `dispatching-parallel-agents`
- Implementation after design closure:
  - `speckit-implement`
- Governance or template updates:
  - `speckit-constitution`
