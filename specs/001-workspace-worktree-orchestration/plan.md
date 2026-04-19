# Implementation Plan: Workspace-Level Worktree Orchestration

**Branch**: `001-workspace-worktree-orchestration` | **Date**: 2026-04-15 | **Last Updated**: 2026-04-17 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-workspace-worktree-orchestration/spec.md`

## Summary

Add a `/dev <name>` slash command (and equivalent `worktree_workspace_create` AI tool) that auto-detects git repos in `<cwd>`, creates a mirrored worktree layout under `<cwd>/../worktrees/<name>/`, reconciles on re-run, and returns exactly one headless workspace-level session. The implementation extracts reusable modules from the current monolithic `worktree.ts`, extends per-project SQLite with workspace tables, and adds new orchestration modules — all while preserving the existing single-repo `worktree_create` / `worktree_delete` behavior unchanged.

## Technical Context

**Language/Version**: TypeScript on Bun runtime (Bun.spawn, Bun.file, bun:sqlite)
**Primary Dependencies**: `@opencode-ai/plugin`, `@opencode-ai/sdk`, `zod`, `jsonc-parser`
**Storage**: Per-project SQLite via `bun:sqlite`, WAL mode, one DB per `{projectId}.sqlite`
**Testing**: No standalone test setup in this facade repo; full test workflow lives in upstream OCX monorepo
**Target Platform**: Cross-platform (macOS, Linux, Windows, WSL) — same as existing plugin
**Project Type**: OpenCode plugin (library loaded by OpenCode runtime)
**Performance Goals**: 5+ repos workspace setup in <30s excluding hooks (SC-001); reconcile in <15s (SC-002)
**Constraints**: No global state files across projects; per-project DB only (FR-021)
**Scale/Scope**: Typical workspace: 2–10 repos, each with independent worktree

## Constitution Check

*GATE: Must pass before implementation. Verified against constitution.md v1.0.0.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| **I. Facade Fidelity** | PASS | New workspace behavior is additive in new modules. AGENTS.md, README.md kept separate from shipped behavior until code lands. |
| **II. Spec-Driven Change Control** | NEEDS RE-VERIFY (this remediation) | Spec updated 2026-04-17 with 7 changes; this remediation aligns plan/tasks in the same change to restore PASS state. Verify by re-running `/speckit.analyze` after applying patches. |
| **III. Additive Compatibility** | PASS | FR-020 requires legacy `worktree_create`/`worktree_delete` unchanged. T007 + T020 verify no regression. New tool + slash command are additive. |
| **IV. Explicit State Ownership** | PASS | WorkspaceMember owned by per-project DB (FR-021). WorkspaceSession binding owned by workspace_associations table. No implicit directory-shape detection. |
| **V. Directory Contract Hygiene** | PASS | New modules under existing `src/plugin/worktree/` which already has `CLAUDE.md` coverage via parent. Spec artifacts under `specs/001-*/`. |
| **Unresolved high-risk gaps** | RESOLVED 2026-04-17 | Additional decisions: FR-005 substitution removed, FR-009 split into confirmed-collision (whole-reject) vs pre-check-failure (per-repo), FR-019 error field MUST when status=failed, FR-023 partial rollback semantics, FR-024 slash-via-markdown. `repoPath` resolution remains open — non-blocking for MVP `/dev`. |

## Project Structure

### Documentation (this feature)

```text
specs/001-workspace-worktree-orchestration/
├── spec.md              # Feature specification (24 FRs, 3 user stories)
├── plan.md              # This file
├── tasks.md             # 24 implementation tasks in 5 phases (incl. T024 for FR-024)
├── context/
│   ├── current-state.md # Shipped code behavior reference
│   └── target-state.md  # Target behavior after implementation
├── cases/
│   ├── reconcile-cases.md
│   ├── workspace-metadata-authority.md (superseded)
│   └── repo-path-resolution.md (open, non-blocking)
└── checklists/
    └── requirements.md  # 42-item quality checklist (9 resolved)
```

### Source Code (repository root)

```text
src/plugin/
├── worktree.ts                    # Plugin entry: tool defs, event handlers, orchestration wiring
├── worktree/
│   ├── config.ts                  # [NEW] Worktree config schema, loading, defaults
│   ├── git.ts                     # [NEW] Git command helpers, branch validation, Result<T,E>
│   ├── sync.ts                    # [NEW] File copy, symlink, hooks execution
│   ├── state.ts                   # [EXTEND] SQLite persistence + workspace tables
│   ├── workspace.ts               # [NEW] Name validation, repo detection, path resolution, locking
│   ├── workspace-create.ts        # [NEW] Pre-check, reconcile, parallel worktree creation
│   ├── workspace-session.ts       # [NEW] Session fork/reuse/rebind, headless helpers
│   ├── launch-context.ts          # [UNCHANGED] OCX vs plain mode detection
│   └── terminal.ts                # [UNCHANGED] Cross-platform terminal spawning
└── kdco-primitives/               # [UNCHANGED] Shared utilities
    ├── get-project-id.ts
    ├── shell.ts
    ├── mutex.ts
    ├── terminal-detect.ts
    ├── with-timeout.ts
    ├── temp.ts
    ├── log-warn.ts
    └── types.ts
```

**Structure Decision**: Single project, extending the existing `src/plugin/worktree/` directory. No new top-level directories. New modules follow existing patterns (Zod schemas at boundary, Result type for fallible operations, Logger interface for structured output).

## Data Model

### Existing Tables (unchanged)

**`sessions`** — single-repo worktree session tracking (owned by `worktree_create`/`worktree_delete`)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Session ID |
| branch | TEXT NOT NULL | Branch name |
| path | TEXT NOT NULL | Worktree path |
| created_at | TEXT NOT NULL | ISO 8601 |
| launch_mode | TEXT | `'plain'` or `'ocx'` |
| profile | TEXT | OCX profile name |
| ocx_bin | TEXT | OCX binary path |

**`pending_operations`** — singleton for deferred spawn/delete

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK CHECK(id=1) | Singleton |
| type | TEXT NOT NULL | `'spawn'` or `'delete'` |
| branch | TEXT NOT NULL | |
| path | TEXT NOT NULL | |
| session_id | TEXT | |

### New Tables

**`workspace_associations`** — workspace identity + session binding (per-project DB)

| Column | Type | Notes |
|--------|------|-------|
| name | TEXT NOT NULL | `/dev <name>` argument |
| workspace_path | TEXT NOT NULL | Normalized absolute target path |
| session_id | TEXT | Forked workspace session ID |
| session_disposition | TEXT | `'forked'` or `'reused'` |
| source_cwd | TEXT NOT NULL | Original `<cwd>` |
| created_at | TEXT NOT NULL | ISO 8601 |
| updated_at | TEXT NOT NULL | ISO 8601 |

Primary key: `(name, workspace_path)`

**`workspace_members`** — per-repo worktree record (per-project DB)

| Column | Type | Notes |
|--------|------|-------|
| workspace_name | TEXT NOT NULL | FK to association name |
| workspace_path | TEXT NOT NULL | FK to association workspace_path |
| repo_name | TEXT NOT NULL | Source repo directory name |
| project_id | TEXT NOT NULL | This repo's project ID |
| branch | TEXT NOT NULL | Stored branch name (frozen on first create) |
| worktree_path | TEXT NOT NULL | Absolute worktree path |
| status | TEXT NOT NULL | `'created'`/`'reused'`/`'retried'`/`'failed'` |
| error | TEXT | Error message when status = 'failed' |
| created_at | TEXT NOT NULL | ISO 8601 |
| updated_at | TEXT NOT NULL | ISO 8601 |

Primary key: `(workspace_name, workspace_path, project_id)`

### State Reconstruction (FR-021 / SC-006)

Workspace membership is reconstructed by: (1) auto-detecting repos in `<cwd>`, (2) computing each repo's projectId, (3) opening each repo's per-project DB, (4) querying `workspace_members WHERE workspace_name = ? AND workspace_path = ?`. No global join required.

## Module Contracts

### `worktree/config.ts` (extracted from worktree.ts lines 128–152, 806–881)

| Export | Signature | Notes |
|--------|-----------|-------|
| `worktreeConfigSchema` | Zod schema | `.opencode/worktree.jsonc` validation |
| `WorktreeConfig` | `z.infer<typeof worktreeConfigSchema>` | |
| `loadWorktreeConfig` | `(repoRoot: string, log: Logger) => Promise<WorktreeConfig>` | Reads/creates JSONC file |
| `resolveHomePath` | `(p: string) => string` | `~` expansion |

### `worktree/git.ts` (extracted from worktree.ts lines 68–123, 609–666)

| Export | Signature | Notes |
|--------|-----------|-------|
| `Result<T,E>` | type + namespace `Result.ok/err` | Shared fallible-op type |
| `branchNameSchema` | Zod schema | Branch name validation |
| `git` | `(args: string[], cwd: string) => Promise<Result<string, string>>` | Shell-safe `Bun.spawn` wrapper |
| `branchExists` | `(branch: string, cwd: string) => Promise<boolean>` | |
| `createWorktree` | `(repoRoot, branch, targetPath, createBranch) => Promise<Result<string, string>>` | |
| `removeWorktree` | `(repoRoot: string, path: string) => Promise<Result<void, string>>` | |
| `worktreeList` | `(repoRoot: string) => Promise<string[]>` | **NEW**: parse `git worktree list --porcelain` |
| `worktreePrune` | `(repoRoot: string) => Promise<Result<void, string>>` | **NEW**: for FR-008 |

### `worktree/sync.ts` (extracted from worktree.ts lines 674–801)

| Export | Signature | Notes |
|--------|-----------|-------|
| `isPathSafe` | `(base: string, target: string) => boolean` | Path traversal guard |
| `copyFiles` | `(files, source, target, log) => Promise<void>` | |
| `symlinkDirs` | `(dirs, source, target, log) => Promise<void>` | |
| `runHooks` | `(hooks, cwd, log, timeoutMs?) => Promise<Result<void, string>>` | Timeout support for FR-011 |

### `worktree/workspace.ts` (new — T008, T009)

| Export | Signature | Notes |
|--------|-----------|-------|
| `WorkspaceName` | branded string type | Validated via regex |
| `DetectedRepo` | `{ name, path, projectId }` | From auto-detect scan |
| `WorkspaceTarget` | `{ name, sourceCwd, workspacePath, repos[] }` | Resolved workspace |
| `validateWorkspaceName` | `(name: string) => Result<WorkspaceName, string>` | FR-002 regex |
| `detectRepos` | `(cwd, client) => Promise<DetectedRepo[]>` | FR-003 scan |
| `resolveWorkspaceTarget` | `(cwd, name) => Promise<Result<WorkspaceTarget, string>>` | FR-004 |
| `acquireWorkspaceLock` | `(workspacePath: string) => Promise<() => void>` | FR-017 mutex |

### `worktree/workspace-create.ts` (new — T011–T016)

| Export | Signature | Notes |
|--------|-----------|-------|
| `MemberStatus` | `'created' \| 'reused' \| 'retried' \| 'failed'` | |
| `MemberOutcome` | `{ name, worktreePath, branch, status, error? }` | FR-019 per-repo |
| `WorkspaceCreateResult` | `{ workspacePath, sessionId, sessionDisposition, repos[], warnings[] }` | FR-019 |
| `PreCheckOutcome` | `{ collisions: CollisionError[], preCheckFailures: PreCheckFailure[] }` | FR-009 dual-path |
| `checkBranchCollisions` | `(plans[], workspacePath) => Promise<PreCheckOutcome>` | FR-009 pre-check (confirmed collisions + per-repo failures) |
| `planRepoWorktrees` | `(target, existingMembers) => RepoWorktreePlan[]` | Classify actions |
| `executeWorktreeCreation` | `(target, plans[], configs) => Promise<MemberOutcome[]>` | FR-007 parallel |
| `orchestrateWorkspaceCreate` | `(ctx, name, client) => Promise<WorkspaceCreateResult>` | Top-level entry |

### `worktree/workspace-session.ts` (new — T006, T010)

| Export | Signature | Notes |
|--------|-----------|-------|
| `SessionDisposition` | `'forked' \| 'reused'` | |
| `WorkspaceSessionBinding` | `{ sessionId, disposition }` | |
| `resolveWorkspaceSession` | `(client, storedId?) => Promise<WorkspaceSessionBinding>` | FR-013/014 |
| `createHeadlessResult` | `(worktreePath, projectId) => HeadlessCreateResult` | US3 |

## Integration Flow

### `/dev <name>` — First Run

```
User invokes /dev prd_1
│
├─ 1. validateWorkspaceName("prd_1")                    [workspace.ts]
├─ 2. detectRepos(<cwd>)                                [workspace.ts]
├─ 3. resolveWorkspaceTarget(<cwd>, "prd_1")            [workspace.ts]
├─ 4. acquireWorkspaceLock(targetPath)                   [workspace.ts]
│
├─ 5. For each repo: git fetch                          [git.ts]
├─ 6. For each repo: compute branch name                [workspace-create.ts]
│     dev_{base_branch}_{name}_{YYMMDD}
│     (base_branch = local short name from git rev-parse --abbrev-ref HEAD,
│      no remote prefix, no substitution; detached HEAD → SHA[:12])
│
├─ 7. checkBranchCollisions(repos, plans)               [workspace-create.ts]
│     └─ If collision → REJECT entire command
│
├─ 8. executeWorktreeCreation(target, plans, configs)    [workspace-create.ts]
│     └─ Per repo (parallel):
│        ├─ git worktree add (or prune+retry, or orphan cleanup+recreate)
│        ├─ copyFiles + symlinkDirs                     [sync.ts]
│        └─ runHooks (postCreate, 30min timeout)        [sync.ts]
│
├─ 9. resolveWorkspaceSession(client)                   [workspace-session.ts]
│     └─ Fork new session → sessionDisposition = "forked"
│
├─ 10. Persist workspace_associations + workspace_members [state.ts]
│      (only if session fork succeeded — FR-023)
│
└─ 11. Return WorkspaceCreateResult                     [worktree.ts]
       { workspacePath, sessionId, "forked", repos[], warnings[] }
```

### `/dev <name>` — Reconcile Run

```
User invokes /dev prd_1 (existing workspace)
│
├─ Steps 1–4: Same as first run
│
├─ 5. Load existing workspace_members from per-project DBs
├─ 6. planRepoWorktrees: classify each repo
│     ├─ Existing + healthy (FR-022) → reuse
│     ├─ Existing + unhealthy → retry (stored branch)
│     ├─ Existing + failed last time → retry
│     ├─ Orphan (dir exists, no DB record) → remove + recreate → retry
│     └─ New repo (not in DB) → create (today's date in branch)
│
├─ 7–8: Same (pre-check + parallel create for non-reused repos)
│
├─ 9. resolveWorkspaceSession(client, storedSessionId)
│     └─ Valid → "reused" / Stale → fork new → "forked"
│
├─ 10–11: Same
```

### `worktree_create` with `headless: true` (US3)

```
SDK calls worktree_create({ branch, headless: true, repoPath })
│
├─ Resolve repo root from repoPath                     [workspace.ts]
├─ Create worktree + sync + hooks                      [git.ts, sync.ts]
├─ Skip terminal spawn, skip session fork
└─ Return { worktreePath, projectId }                   [workspace-session.ts]
```

## Risk Register

| Risk | Mitigation | FR |
|------|------------|-----|
| Session fork API instability | Retain worktrees on disk, skip DB writes, return error. Next run reconciles. | FR-015 |
| `git worktree add` race with external tools | Per-workspace-path mutex serializes concurrent `/dev` invocations | FR-017 |
| Ghost worktree metadata from manual cleanup | Auto-prune + retry | FR-008 |
| Branch collision with external worktrees | Pre-check before any mutation; **confirmed collision** → whole-command reject; **per-repo pre-check failure** (transient I/O, lock) → per-repo `status="failed"`, others continue | FR-009 |
| Orphan directories from prior failures | Detect orphan, remove, recreate | FR-007 |
| Hook timeouts blocking workspace setup | Per-repo 30min timeout, `failed` status, others unblocked | FR-011/012 |
| DB writes out of order on crash | Worktrees first → session fork → member writes. Crash before writes = orphans handled on next run | FR-023 |

## Complexity Tracking

No constitution violations requiring justification. The implementation stays within a single project directory (`src/plugin/worktree/`), uses the existing per-project SQLite pattern, and adds no new external dependencies.
