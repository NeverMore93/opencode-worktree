# Repository Context

This file is retained as a stable architecture reference, but the canonical
entrypoints are now:

- `../project-memory.md`
- `../active-feature-context.md`
- `../../AGENTS.md`

## Repository Role

- This repository is a facade for the OCX worktree plugin rather than the
  canonical implementation source for shipped code.
- Canonical upstream references:
  - `https://github.com/kdcokenny/ocx/blob/main/workers/kdco-registry/files/plugins/worktree.ts`
  - `https://github.com/kdcokenny/ocx/tree/main/workers/kdco-registry/files/plugins/worktree`

## Working Guidance

- Treat `AGENTS.md` as the top-level agent entrypoint for this repository.
- Put new stable repo truths in `../project-memory.md`.
- Put feature-local current/target state under `specs/<feature>/context/`.
