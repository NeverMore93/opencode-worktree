# Current State

## Shipped Behavior

- The shipped plugin currently exposes only single-repo `worktree_create` and
  `worktree_delete`.
- `worktree_create` assumes the repo root is `ctx.directory`.
- `worktree_create` creates one git worktree, applies sync and hooks, forks one
  session, and launches one terminal.
- `worktree_delete` records one pending delete and performs actual cleanup on
  `session.idle`.

## Current Path Layout

```text
<repo-root>/
└── .opencode/
    └── worktree.jsonc

${HOME}/.local/share/opencode/worktree/
└── <projectId>/
    └── <branch>/

${HOME}/.local/share/opencode/plugins/worktree/
└── <projectId>.sqlite
```

## Current Persisted State

- Per-project SQLite only
- Current tables:
  - `sessions(id, branch, path, created_at, launch_mode, profile, ocx_bin)`
  - `pending_operations(id=1, type, branch, path, session_id)`

## Current Constraint For Feature Design

- Multi-repo workspace state does not exist in shipped code yet.
- Any feature design must preserve legacy single-repo behavior unless the spec
  explicitly changes it.
