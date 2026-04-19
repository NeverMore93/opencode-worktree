# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

An OpenCode plugin (`@opencode-ai/plugin`) that currently provides single-repo git worktree management with automatic terminal spawning. When an AI calls `worktree_create`, a new terminal opens with OpenCode running in an isolated worktree. On `worktree_delete`, changes auto-commit and the worktree cleans up.

This is a **facade repository** synced from the main [OCX monorepo](https://github.com/kdcokenny/ocx). The canonical source lives at:
- `https://github.com/kdcokenny/ocx/blob/main/workers/kdco-registry/files/plugins/worktree.ts`
- `https://github.com/kdcokenny/ocx/tree/main/workers/kdco-registry/files/plugins/worktree`

Issues and PRs should be opened on the OCX repo, not here.

## Current Runtime Truth

- The code in this facade exposes three tools: `worktree_create`,
  `worktree_delete`, and `worktree_workspace_create`.
- `worktree_create` supports both interactive mode (terminal + session fork)
  and headless mode (`headless: true` skips terminal and session fork,
  returns `{ worktreePath, projectId }`). Optional `repoPath` targets a
  specific repo instead of the session's `ctx.directory`.
- `worktree_delete` records one pending delete and performs cleanup on
  `session.idle`.
- `worktree_workspace_create` auto-detects git repos in `<cwd>`, creates a
  mirrored worktree layout under `<cwd>/../worktrees/<name>/`, runs per-repo
  sync and hooks in parallel, forks exactly one workspace-level session
  (always headless), and returns `WorkspaceCreateResult`.
- `/dev <name>` slash command is registered via OpenCode's native custom-command
  convention: the plugin auto-creates `.opencode/commands/dev.md` on first
  activation (FR-024, `ensureDevCommand` in `src/plugin/worktree/dev-command.ts`).
  OpenCode scans `{command,commands}/**/*.md` on config load, discovers the
  file, and registers `/dev` alongside built-ins (`init`, `review`). The
  markdown body uses `$ARGUMENTS` substitution to invoke the
  `worktree_workspace_create` AI tool; both surfaces are MVP and behaviour-
  equivalent. Auto-create is idempotent — user edits to `dev.md` are preserved.
- Plugin-owned state is persisted per project:
  - worktree path default: `${HOME}/.local/share/opencode/worktree/<projectId>/<branch>`
  - database path default: `${HOME}/.local/share/opencode/plugins/worktree/<projectId>.sqlite`
  - tables: `sessions`, `pending_operations`, `workspace_associations`,
    `workspace_members`
  - DB pool supports multiple project databases in a single plugin lifecycle.

## Active Feature Focus

The active design track in this repo is `001-workspace-worktree-orchestration`.
Current upstream behavior is still single-repo only; the workspace-level
orchestration feature is being designed here before implementation.

Resolved design decisions captured from the current feature thread (aligned
with spec.md, 2026-04-15):

- The triggering surface is `/dev <name>` slash command plus an equivalent
  `worktree_workspace_create` AI tool. Both map to the same behavior.
- `/dev` is always headless: it forks a session and returns `sessionId`; the
  caller decides how to launch or connect.
- Repos are auto-detected by scanning direct subdirectories of `<cwd>` for
  git repositories. No explicit repos list.
- Target workspace path: `<cwd>/../worktrees/<name>/`.
- Branch name on first creation: `dev_{base_branch}_{name}_{YYMMDD}`, stored
  on first create and reused verbatim on subsequent runs. `base_branch` is
  the local short name from `git rev-parse --abbrev-ref HEAD` preserved as-is
  (slashes in branch names like `feature/login` are NOT substituted — the
  iteration-2 `/`→`-` rule was removed in spec Part 3). Detached HEAD uses
  SHA[:12] (extended from SHA[:8] in Part 3 for collision resistance in
  large monorepos).
- Workspace mode always uses exactly one workspace-level session; per-repo
  sessions are never auto-created.
- Repeated create is reconcile, not rebuild. Per-repo status set:
  `{created, reused, retried, failed}`.
- A worktree is healthy when: dir exists + `.git` entry + `git worktree list`
  includes the path (FR-022). Otherwise it needs retry.
- Orphan worktrees (dir on disk, no DB record) are removed and recreated.
- Branch collision detection is a pre-check phase before any mutations
  (FR-009 dual-path): (a) **confirmed branch collision** — target branch
  already checked out at a live worktree outside the target workspace —
  rejects the entire command before any `git worktree add`; (b) **pre-check
  failure on a single repo** — `git worktree list` errors, lock held,
  transient I/O — marks that single repo `status="failed"` and excludes it
  from subsequent steps while other repos continue. Whole-command reject is
  reserved exclusively for case (a).
- Mutation ordering (FR-023): pre-check → worktrees+sync+hooks → session
  fork → member writes (only after fork succeeds).
- State is persisted in per-project databases keyed by each repo's project ID.
  No global `workspace_registry.sqlite` in MVP.
- The command does not spawn a terminal, does not auto-commit, and does not
  auto-push.
- Single-repo `worktree_create` contract is preserved unchanged.

Explicitly out of MVP scope:

- `worktree_workspace_delete` (users manually clean up)
- `localState.files` / overlay files
- `mismatch` status / branch-baseBranch mismatch semantics
- `--force` mode, dirty-worktree guards
- Global `workspace_registry.sqlite`

Still-open design gaps that must stay explicit until resolved:

- `worktree_create.repoPath` may point at any local path, but the rule for
  resolving non-repo or container directories into a unique repo root is not
  yet finalized. (Applies to legacy single-repo tool only; MVP `/dev` uses
  auto-detect.)

## Architecture

```
src/plugin/
├── worktree.ts              # Plugin entry: worktree_create, worktree_delete, worktree_workspace_create tools + ensureDevCommand wire-up
├── worktree/
│   ├── config.ts            # .opencode/worktree.jsonc schema + loader (auto-creates defaults)
│   ├── dev-command.ts       # FR-024: auto-create .opencode/commands/dev.md for /dev slash command
│   ├── git.ts               # Shell-safe git command wrapper, branch name validation, Result<T,E>
│   ├── launch-context.ts    # OCX vs plain launch mode detection/serialization (legacy path)
│   ├── state.ts             # SQLite per-project DB pool (sessions, pending, workspace_associations, workspace_members)
│   ├── sync.ts              # File copy, symlink, hook execution with timeout
│   ├── terminal.ts          # Cross-platform terminal spawning with mutex protection (legacy path)
│   ├── workspace.ts         # Name validation, auto-detect git repos, path resolution, per-path mutex
│   ├── workspace-create.ts  # Pre-check, reconcile planning, parallel execution, FR-023 ordering
│   └── workspace-session.ts # Workspace-level session fork/reuse (always headless for /dev)
└── kdco-primitives/         # Shared utilities across kdco registry plugins
    ├── get-project-id.ts    # Stable project ID from git root commit SHA (with path-hash fallback)
    ├── shell.ts             # Shell escaping (bash, batch, AppleScript)
    ├── mutex.ts             # Promise-based FIFO mutex for serializing async ops
    ├── terminal-detect.ts   # Terminal emulator detection (tmux > cmux > env vars > fallback)
    ├── with-timeout.ts      # Promise timeout wrapper
    ├── temp.ts              # Temp directory resolution
    ├── log-warn.ts          # Structured logging via OpenCode client
    └── types.ts             # OpencodeClient type from @opencode-ai/sdk
```

### Key Design Patterns

- **Result<T, E> type** — Fallible operations return `{ok: true, value}` or `{ok: false, error}` instead of throwing. Only boundary/invariant violations throw.
- **Zod boundary validation** — All external inputs (branch names, config, DB rows) are validated with Zod schemas at the boundary. Internal code trusts validated types.
- **Singleton SQLite via bun:sqlite** — One DB per plugin lifecycle, WAL mode, process cleanup handlers for graceful shutdown.
- **Pending operations pattern** — `worktree_delete` sets a pending flag; actual cleanup runs on `session.idle` event (auto-commit, preDelete hooks, git worktree remove).
- **Session forking** — `worktree_create` forks the current OpenCode session, copies plan.md and delegations, then launches in a new terminal.

Current implementation note:

- Multi-repo workspace tables (`workspace_associations`, `workspace_members`)
  are implemented in `src/plugin/worktree/state.ts` per FR-021 (per-project
  DB only; no global workspace registry). Mutation ordering per FR-023:
  pre-check → parallel create+sync+hooks → session fork → DB writes (only
  for successful repos; fork failure retains worktrees on disk without DB
  records, recovered on next reconcile via FR-007 orphan handling).

### Runtime

- **Bun** — Uses `Bun.spawn`, `Bun.file`, `Bun.write`, `Bun.which`, `Bun.spawnSync`, `bun:sqlite`
- **Dependencies**: `@opencode-ai/plugin`, `@opencode-ai/sdk`, `zod`, `jsonc-parser`

## Development

This plugin runs inside OpenCode's plugin runtime. There is no standalone build/test/lint setup in this facade repo. To develop:

1. Copy `src/` to `.opencode/plugin/` in a project
2. Install `jsonc-parser` as a dependency
3. OpenCode loads the plugin on startup

For the full development workflow with tests and linting, work in the [OCX monorepo](https://github.com/kdcokenny/ocx).

## SpecKit Workflow

This project uses SpecKit for specification-driven development.

- Codex uses user-scoped SpecKit skills installed under `$CODEX_HOME/skills` (or `~/.codex/skills` on default setups)
- Claude Code uses project-local commands under `.claude/commands/`
- Shared templates and automation scripts live under `.specify/`

Available SpecKit workflows in this repo:

- `$speckit-specify` / `/speckit.specify` — Create/update feature specification
- `$speckit-plan` / `/speckit.plan` — Generate implementation plan from spec
- `$speckit-tasks` / `/speckit.tasks` — Generate dependency-ordered task list
- `$speckit-implement` / `/speckit.implement` — Execute implementation plan
- `$speckit-analyze` / `/speckit.analyze` — Cross-artifact consistency check
- `$speckit-clarify` / `/speckit.clarify` — Identify underspecified areas
- `$speckit-checklist` / `/speckit.checklist` — Generate custom checklist
- `$speckit-constitution` / `/speckit.constitution` — Create/update project constitution
- `$speckit-taskstoissues` / `/speckit.taskstoissues` — Convert tasks to GitHub issues

## Repository Memory

Durable repo-level context for future sessions lives under `.specify/memory/`:

- `.specify/memory/constitution.md` — repo governance and change rules
- `.specify/memory/README.md` — memory index
- `.specify/memory/project-memory.md` — durable operating rules for repo truth
- `.specify/memory/project-context.md` — compatibility pointer for older
  references
- `.specify/memory/active-feature-context.md` — active feature decisions,
  recommendations, and open questions
- `.specify/memory/contexts/repository-context.md` — stable repository layout
  and shipped implementation reference
- `.specify/memory/contexts/current-vs-target-state.md` — current vs target
  path/state model comparison
- `.specify/memory/cases/001-workspace-worktree-orchestration.md` — primary
  active feature case record
- `.specify/memory/cases/workspace-metadata-authority.md` — workspace metadata
  authority case
- `.specify/memory/cases/repo-path-resolution.md` — open repo-root resolution
  case
- `.specify/memory/skills/project-skill-map.md` — preferred skill and subagent
  usage for this repo

Feature-local intent, design, and executable work still live under
`specs/001-workspace-worktree-orchestration/`, especially `spec.md`,
`plan.md`, `tasks.md`, and `checklists/`.

Do not auto-regenerate this file or root `CLAUDE.md` from the generic SpecKit
agent-context template without explicit review. In this repo, those files are
curated guidance, not disposable generated summaries.

## Platform Notes

- Terminal detection priority: tmux (if inside) > cmux (if `CMUX_WORKSPACE_ID` or socket) > WSL > `TERM_PROGRAM`/env vars > system fallback
- Windows support uses `wt.exe` (Windows Terminal) with `cmd.exe` fallback; batch escaping via `escapeBatch()`
- Ghostty on macOS uses inline commands to avoid permission dialogs
- tmux commands are serialized through a `Mutex` to prevent socket races
