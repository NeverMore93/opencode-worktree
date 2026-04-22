# Feature Specification: Workspace-Level Worktree Orchestration

**Feature Branch**: `001-workspace-worktree-orchestration`
**Created**: 2026-03-28
**Last Updated**: 2026-04-17
**Status**: Draft
**Input**: User description: "Workspace-level worktree orchestration: Add `/dev <name>` slash command that creates git worktrees across multiple repos in a mirrored directory structure, with session fork at workspace level. Always headless for SDK-driven workflows."

## Clarifications

### Session 2026-04-13

- Q: Should `worktree_workspace_create` support `headless`, and if so should it skip both terminal and session fork, skip terminal but keep session, or remain interactive-only? → A: `worktree_workspace_create` supports `headless`; in headless mode it skips terminal spawning but still forks and returns a workspace-level session.
- Q: When `worktree_workspace_create` succeeds, should it create only a workspace-level session or both a workspace-level session and per-repo sessions? → A: It creates exactly one workspace-level session; per-repo repos are tracked as workspace members/worktree records, not auto-created sessions.
- Q: Should `worktree_workspace_create` support repeated execution against an existing target workspace? → A: Yes. Re-running against an existing target workspace performs per-repo reconciliation: existing healthy members are kept, while missing or failed members are created or retried.
- Q: During reconciliation, what happens if an existing healthy member's `branch` or `baseBranch` does not match the new request? → A (superseded in Session 2026-04-14 Part 2): branch name is derived from stored state, so mismatch cannot occur through normal command usage.
- Q: When `worktree_workspace_create` reconciles an existing target workspace, should it reuse an existing workspace-level session or create a new one? → A: It reuses an existing valid workspace-level session; only when the session binding is missing or stale does it fork and bind a new workspace-level session.
- Q: Should local-only file behavior (e.g., CLAUDE.md overlay) be supported? → A (superseded in Session 2026-04-14 Part 2): Not in MVP. Files follow normal branch-tracked content.
- Q: Should `worktree_workspace_create` consume existing sync config or a distinct node? → A (superseded): Use existing sync config, no distinct node.
- Q: When a reconciliation request omits some previously managed healthy workspace members, should the system preserve them, surface them as drift, fail the request, or remove them? → A: Preserve omitted healthy members unchanged; they do not participate in the current reconcile operation, and the response only reports repos explicitly included in the current request. (Simplified in Part 2: auto-detect replaces explicit repos list.)
- Q: Should single-repo `worktree_create.repoPath` accept only relative paths, only workspace-root-relative paths, or both relative and absolute paths? → A: Accept both relative and absolute paths.

### Session 2026-04-14 (Part 1)

- Q: Where should authoritative workspace-level metadata live for multi-repo workspace orchestration? → A (superseded in Part 2): Originally decided as global `workspace_registry.sqlite` + per-project databases. Simplified to per-project databases only.

### Session 2026-04-14 (Part 2)

- Q: What is the triggering surface for workspace orchestration? → A: `/dev <name>` slash command plus an equivalent AI tool `worktree_workspace_create`. Both map to the same behavior.
- Q: How are repos specified? → A: Auto-detect git repositories among the direct subdirectories of the current session cwd. No explicit repos list. Submodules are not recursed into.
- Q: What branch name is used for each repo's worktree? → A: `dev_{base_branch}_{name}_{YYMMDD}` on first creation, where `base_branch` is each repo's current HEAD at that moment. Stored in state on first create and reused on re-run — date does not re-roll.
- Q: Does `/dev` spawn a terminal? → A: No. `/dev` is always headless. It forks a session and returns `sessionId`; the caller decides how to launch or connect to the session.
- Q: Is `worktree_workspace_delete` in scope? → A: No. Removed from MVP. Users manually clean up via `rm` + `git worktree prune`.
- Q: How to handle an existing target workspace directory that was not created by the plugin? → A: Do not reject. Proceed with reconciliation logic. If the target root contains files not managed by the plugin, surface a warning in the response.
- Q: How to handle ghost git worktree metadata (directory removed without `git worktree prune`)? → A: Auto-prune and retry transparently; the affected repo is reported as `retried`.
- Q: How to handle a branch whose name collides with a live worktree already checked out at a different path? → A: Reject the entire command (no partial success). Caller must resolve the conflict first.
- Q: How to handle fork session API failure after worktrees were created? → A: Retain the created worktrees on disk but do not write member records to the per-project database. Caller sees an error; next `/dev` run treats those worktrees as unmanaged and re-creates state via normal reconciliation.
- Q: How to handle submodules discovered during scan? → A: Skip (do not recurse into submodules). Git's natural behavior applies once the top-level repo is worktree'd.
- Q: How to detect remote branch collisions? → A: `git fetch` per repo before computing branch state, by default.
- Q: Do `hooks.postCreate` have a timeout? → A: Yes. Configurable per repo, default 30 minutes.
- Q: Can the command run long-running tasks (e.g., `pnpm install`)? → A: Yes, via `hooks.postCreate`. But the command itself still must not auto-commit or auto-push.
- Q: Should authoritative workspace metadata live in a global registry or per-project DB only? → A: Per-project DB only. No global registry in MVP.
- Q: Should the spec still include `localState.files` / `workspace_delete` / `--force` / dirty protection / mismatch semantics? → A: No. All removed from MVP for simplicity.
- Q: What is the final slash command name? → A: `/dev`.

### Session 2026-04-17 (Part 3 — gap-driven refinements)

- Q: Is `/dev` truly deferred because `@opencode-ai/plugin` lacks slash registration? → A (challenge resolved): No. OpenCode supports user-defined slash commands via `.opencode/commands/<name>.md` markdown files (official `.opencode/commands/` convention). The plugin ships a 2-line `dev.md` that invokes the `worktree_workspace_create` AI tool. Both surfaces are MVP. Previous "slash deferred" assumption is removed.
- Q: How should `base_branch` be derived from the repo's HEAD? → A: Use the **local short branch name** (`git rev-parse --abbrev-ref HEAD`). Do NOT include any remote prefix. `origin/release` collapses to `release`. Slashes in branch names (e.g., `feature/login`) are preserved as-is.
- Q: When HEAD is detached, what placeholder is used in place of `base_branch`? → A: First 12 hex characters of the commit SHA (SHA[:12]). 8 chars previously suggested but extended to 12 to reduce birthday-paradox collision risk in monorepos.
- Q: Should `/` characters in `base_branch` be substituted with `-` (the iteration-2 unauthorized rule)? → A: No. Remove the substitution entirely. Git natively supports `/` in branch names; the substitution introduced silent collision risk (`feature/login` and `feature-login` mapping to the same name) and was not authorized by any prior clarify decision.
- Q: When step 2 (parallel worktree creation) of FR-023 has partial failures, does the command abort or continue? → A: Continue. Failed repos are marked `status="failed"` with mandatory `error` field. Step 3 (session fork) and step 4 (DB writes for successful repos only) proceed. The overall response is partial success.
- Q: When the FR-009 pre-check itself fails on a single repo (e.g., `git worktree list` errors), is it whole-command reject or per-repo failure? → A: Per-repo failure (`status="failed"` with descriptive `error`). Other repos continue pre-check and execution. Whole-command reject is reserved only for actual branch conflicts (live worktree elsewhere holding the target branch).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Multi-Repo Workspace with `/dev <name>` (Priority: P1)

A developer working on a feature that spans multiple repositories runs `/dev <name>` from the directory that contains those repos. The plugin auto-detects all direct-child git repos, creates a mirrored worktree layout under `<cwd>/../worktrees/<name>/`, checks each repo out to a consistent branch named `dev_{base_branch}_{name}_{YYMMDD}`, runs per-repo sync and `postCreate` hooks, forks the current OpenCode session once, and returns the workspace path and session ID. No terminal is opened; the caller decides how to connect to the forked session.

**Why this priority**: This is the core value proposition — enabling multi-repo isolated development in a single operation.

**Independent Test**: Run `/dev prd_1` from a directory containing two git repos; verify that `worktrees/prd_1/<repoA>` and `worktrees/prd_1/<repoB>` are created on the expected branch names, the response includes a forked session ID with `sessionDisposition = "forked"`, and no terminal window opens.

**Acceptance Scenarios**:

1. **Given** `<cwd>` contains `repoA` (on main) and `repoB` (on develop), **When** the user runs `/dev prd_1`, **Then** the plugin creates `<cwd>/../worktrees/prd_1/repoA` on branch `dev_main_prd_1_{today}` and `<cwd>/../worktrees/prd_1/repoB` on branch `dev_develop_prd_1_{today}`, runs each repo's sync and `postCreate` hooks, forks a session, and returns `{ workspacePath, sessionId, sessionDisposition: "forked", repos: [...] }`.
2. **Given** `<cwd>` contains three repos, one of which fails its `postCreate` hook, **When** the user runs `/dev prd_1`, **Then** that repo's `status = "failed"` with an error message, the other two repos report `status = "created"`, and the response represents a partial success.
3. **Given** the branch `dev_main_prd_1_{today}` is already checked out by a live worktree at a path outside `worktrees/prd_1/`, **When** the user runs `/dev prd_1`, **Then** the plugin rejects the entire command and reports the conflict; no worktrees are created for any repo.
4. **Given** git worktree metadata references a ghost path (directory removed but prune not run), **When** the user runs `/dev prd_1`, **Then** the plugin runs `git worktree prune` automatically and retries, reporting `status = "retried"` for that repo without user intervention.
5. **Given** `<cwd>` contains no git repos, **When** the user runs `/dev prd_1`, **Then** the command fails with a clear error and makes no filesystem changes.
6. **Given** the target directory `<cwd>/../worktrees/prd_1/` already exists with unrelated files at its root, **When** the user runs `/dev prd_1`, **Then** the plugin proceeds with reconciliation, creates worktrees in each expected subpath, and returns a warning listing the unmanaged root-level files.

---

### User Story 2 - Re-running `/dev <name>` Reconciles State (Priority: P1)

A developer returns to an existing multi-repo workspace and runs `/dev prd_1` again, possibly after a partial failure or after adding a new repo to the source directory. The plugin reads state, keeps healthy worktrees as-is, re-creates any missing or corrupted worktrees using the originally stored branch name (no date re-rolling), and reuses the existing workspace session when still valid.

**Why this priority**: Re-runnability makes the command safe to retry and composable with other workflows.

**Independent Test**: Create a workspace, delete one of the worktree directories, re-run `/dev <name>`, verify the missing one is recreated with `status = "retried"` while the other reports `status = "reused"`, and the same session ID is returned with `sessionDisposition = "reused"`.

**Acceptance Scenarios**:

1. **Given** a workspace `prd_1` was created yesterday with repoA and repoB, **When** the user runs `/dev prd_1` today, **Then** the plugin reuses the stored branch names (including yesterday's date) and reports both repos with `status = "reused"` and `sessionDisposition = "reused"`.
2. **Given** a workspace `prd_1` exists but `worktrees/prd_1/repoA` was deleted, **When** the user runs `/dev prd_1`, **Then** repoA is re-added (`status = "retried"`), repoB is left alone (`status = "reused"`), and the response reflects both.
3. **Given** the stored workspace session ID is no longer valid (session was deleted), **When** the user runs `/dev prd_1`, **Then** the plugin forks a new workspace session, rebinds it, and returns `sessionDisposition = "forked"` with the new session ID.
4. **Given** `<cwd>` now contains a new repoC that was not in the workspace before, **When** the user runs `/dev prd_1`, **Then** repoC is created fresh with today's date in its branch name (`status = "created"`), while existing members keep their original branch names.
5. **Given** fork of the workspace session fails after worktrees were already created, **When** the error returns, **Then** the worktrees remain on disk, but no member records are persisted to the per-project database; the next `/dev prd_1` run treats those worktrees as orphans and rebuilds state via reconciliation.

---

### User Story 3 - Headless `worktree_create` with `repoPath` for SDK Workflows (Priority: P2)

An SDK caller needs to create a single-repo worktree outside an interactive session. They invoke the legacy `worktree_create` tool with `headless: true` and optionally a `repoPath` pointing to any local path. The plugin creates the worktree, runs sync and hooks, skips both terminal and session fork, and returns `{ worktreePath, projectId }`.

**Why this priority**: The legacy single-repo tool continues to serve single-repo use cases and is now unambiguously headless for SDK consumers.

**Independent Test**: Invoke `worktree_create` via SDK with `headless: true`; verify the worktree is created and no terminal/session side effects occur.

**Acceptance Scenarios**:

1. **Given** a repo at `/path/to/repoA`, **When** `worktree_create({ branch: "feat/x", headless: true, repoPath: "/path/to/repoA" })` is called, **Then** the worktree is created, sync and hooks run, and the response is `{ worktreePath, projectId }` — no terminal spawns and no session forks.
2. **Given** `headless: false` (default) and no `repoPath`, **When** `worktree_create` is called from inside an OpenCode session, **Then** the pre-existing behavior (terminal spawn + session fork + session record) is preserved unchanged.

---

### Edge Cases

- **`<cwd>` has no git repos** → the command fails with a clear error; no filesystem changes.
- **Target directory contains files unrelated to the plugin** → proceed; report those root-level items as warnings in the response.
- **Ghost git worktree metadata** (dir deleted, metadata stale) → auto `git worktree prune`, retry; `status = "retried"`.
- **Live worktree at a different path holds the target branch** → reject the entire `/dev` command; no partial success.
- **Two concurrent `/dev` calls for the same `<name>`** → lock by normalized target path; the loser receives a busy/conflict error.
- **Two concurrent `/dev` calls for different `<name>`** → run in parallel; no interference.
- **Submodule in a scanned repo** → not recursed into; the parent repo is worktree'd normally and git handles the submodule per its own rules.
- **`name` does not match `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`** → reject with a validation error.
- **`postCreate` hook exceeds the configured timeout (default 30 min)** → that repo's `status = "failed"` with a timeout error; other repos unaffected (partial success).
- **Fork session API fails after worktrees were created** → worktrees retained on disk; no member records written; command reports error.
- **A repo previously in the workspace is now absent from `<cwd>`** → skip silently, not represented in the current response.
- **Windows symlinks fall back to copy** → existing `sync.symlinkDirs` fallback behavior applies; not specific to this command.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `/dev <name>` slash command and an equivalent `worktree_workspace_create` AI tool that both accept the workspace name and produce identical behavior.
- **FR-002**: System MUST validate the `<name>` argument against the pattern `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` (1–64 characters, ASCII alphanumeric plus `_` and `-`, must start with an alphanumeric character). Names that do not match MUST be rejected with a validation error before any side effects. This allowlist implicitly excludes `/`, shell metacharacters, empty strings, names starting with `-`, and platform-reserved names such as `.`, `..`, `CON`, `NUL`, etc.
- **FR-003**: System MUST auto-detect git repositories by scanning the direct subdirectories of the current session `cwd` (non-recursive). Submodules MUST NOT be recursed into.
- **FR-004**: System MUST resolve the target workspace path as `<cwd>/../worktrees/<name>/`.
- **FR-005**: System MUST compute each repo's branch name on first creation as `dev_{base_branch}_{name}_{YYMMDD}`, where `base_branch` is the **local short branch name** of the repo's current HEAD (equivalent to `git rev-parse --abbrev-ref HEAD`). Remote prefixes such as `origin/` MUST be stripped (`origin/release` → `release`). Slashes in `base_branch` (e.g., `feature/login` → `dev_feature/login_prd_1_260417`) MUST be preserved as-is; no character substitution is performed. If HEAD is detached, `base_branch` MUST be the first 12 hex characters of the commit SHA (SHA[:12]). The stored branch name MUST be reused verbatim on subsequent reconciliation runs (no date re-rolling). If the stored branch was manually deleted from the source repo between runs, the system MUST recreate it via `git worktree add -b` using the stored name (FR-007 applies).
- **FR-006**: System MUST run `git fetch` against each repo before determining branch state, so remote-side branches are visible during existence checks.
- **FR-007**: System MUST create worktrees in parallel across repos. If the branch already exists locally or remotely, the plugin MUST check it out; if it does not exist, the plugin MUST create it with `-b`. If the target worktree path already exists on disk but has no corresponding WorkspaceMember record in the per-project database (orphan from a prior failed run per FR-015), the system MUST remove the orphan directory and recreate the worktree cleanly; such a repo MUST be reported as `status = "retried"`.
- **FR-008**: System MUST automatically run `git worktree prune` when `git worktree add` fails due to stale metadata, then retry; the repo MUST be reported as `status = "retried"` on success.
- **FR-009**: System MUST perform a **pre-check phase** before any `git worktree add` mutation: for every repo in the current request, verify that the target branch is not already checked out by a live worktree at a path outside the target workspace. If an actual **branch collision** is detected (target branch is currently checked out at an external worktree), the system MUST reject the entire command (no partial success) before creating any worktrees; the error MUST name the conflicting repo, branch, and the external worktree path. If the **pre-check itself fails** for a specific repo (e.g., `git worktree list` errors, lock held, transient I/O failure), that single repo MUST be marked `status="failed"` with a descriptive `error` field and excluded from subsequent steps; other repos continue both pre-check and execution. Whole-command reject is reserved exclusively for confirmed branch collisions.
- **FR-010**: System MUST run each repo's `.opencode/worktree.jsonc` `sync.copyFiles`, `sync.symlinkDirs`, and `hooks.postCreate` after its worktree is created, matching the behavior of the existing `worktree_create` tool.
- **FR-011**: System MUST enforce a timeout on each `postCreate` hook. The default MUST be 30 minutes and MUST be overridable per repo via `.opencode/worktree.jsonc`. A timeout MUST surface as a `status = "failed"` result for that repo without blocking others.
- **FR-012**: Per-repo failures MUST NOT block other repos except in the specific case described by FR-009.
- **FR-013**: System MUST fork the current session exactly once at workspace level and return its ID. If a valid workspace session already exists for the target, it MUST be reused; if none exists or the stored session is stale, a new session MUST be forked.
- **FR-014**: System MUST define a workspace session as stale when the OpenCode SDK reports the session no longer exists. A valid workspace session is one whose ID resolves through the SDK and whose stored metadata still binds to the current target workspace path.
- **FR-015**: When fork of the workspace session fails after worktrees were created, the system MUST retain the created worktrees on disk and MUST NOT write member records to the per-project database; the command MUST return an error that describes the retained worktrees.
- **FR-016**: System MUST treat a target directory that contains unrelated root-level content as compatible for reconciliation; such content MUST be reported as warnings in the response but MUST NOT block execution. The plugin MUST only write into `<target>/<repoName>/` subpaths and MUST NOT modify pre-existing root-level files.
- **FR-017**: System MUST serialize concurrent `/dev <name>` invocations that target the same workspace path. Concurrent invocations with different names MAY run in parallel.
- **FR-018**: The system MUST NOT spawn a terminal, MUST NOT auto-commit any worktree changes, and MUST NOT auto-push any branches.
- **FR-019**: The response MUST include: `workspacePath`, `sessionId`, `sessionDisposition` (`"forked" | "reused"`), `repos` (array of `{ name, worktreePath, branch, status, error? }` with `status ∈ {created, reused, retried, failed}`; `error` is a human-readable string that MUST be present whenever `status = "failed"` and MUST describe the specific failure cause — pre-check failure, hook timeout, branch unavailable, etc.), and `warnings` (array of human-readable strings). Partial-success responses (some repos `failed`) MUST still return the workspace `sessionId` and a complete `repos` array including failed entries.
- **FR-020**: The existing `worktree_create` tool's contract (including terminal spawn when `headless = false`, and accepting both relative and absolute `repoPath`) MUST be preserved unchanged.
- **FR-021**: State MUST be persisted in per-project databases keyed by each repo's project ID. No global workspace registry is required; workspace membership MUST be reconstructable from per-project records keyed by the `<name>` and target path.
- **FR-022**: A workspace member worktree is **healthy** when all of the following are true: (a) the worktree directory exists on disk, (b) the directory contains a `.git` file or directory, and (c) the repo's `git worktree list` output includes the worktree path. If any condition fails, the member MUST be classified as needing retry rather than reuse.

- **FR-024**: The plugin MUST auto-create `.opencode/commands/dev.md` on first activation if absent, with frontmatter and a template that invokes the `worktree_workspace_create` tool with `name=$ARGUMENTS`. This file makes `/dev <name>` available as a user-typed slash command via OpenCode's standard custom-command convention. The auto-create logic MUST follow the same pattern used for `.opencode/worktree.jsonc` (idempotent, never overwrites user-modified content).
- **FR-023**: The system MUST follow this mutation ordering for each `/dev <name>` invocation: (1) pre-check for branch collisions and per-repo pre-check viability (FR-009), (2) create/reconcile all worktrees and run sync/hooks in parallel across repos — repos that fail any sub-step in this phase MUST be marked `status="failed"` with `error` populated (FR-019) but MUST NOT abort step 3 for the remaining successful repos, (3) fork or reuse the workspace session (FR-013), (4) write WorkspaceMember records to per-project databases for **only the successful repos** after session fork succeeds. If session fork itself fails, no member records are written for any repo (FR-015 applies). The overall response is partial success when ≥1 repo succeeds; the response MUST NOT be classified as whole-command failure unless FR-009 confirmed-collision triggers it or FR-015 fork failure triggers it.

### Key Entities

- **Workspace**: A target directory at `<cwd>/../worktrees/<name>/`. Keyed by the normalized absolute target path. Holds one workspace-level session binding.
- **WorkspaceSession**: The single forked OpenCode session returned by `/dev`. Always headless from this command. May be reused across reconciliation runs while the session remains valid (resolvable via SDK).
- **WorkspaceMember**: A per-repo worktree record within a workspace. Contains repo identity, projectId, stored branch name, worktree path, and last status. Persisted in the repo's per-project database and linked to the workspace by the `<name>` + target path.
- **HooksConfig**: The `hooks.postCreate` and (legacy) `hooks.preDelete` declared in each repo's `.opencode/worktree.jsonc`, plus an optional timeout override.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can run `/dev <name>` from a directory with 5+ repos and receive a fully set-up mirrored workspace in under 30 seconds, excluding user-defined `postCreate` hook time.
- **SC-002**: Re-running `/dev <name>` on an existing workspace with at most one missing or failed member completes in under 15 seconds and returns `status` values that precisely distinguish `created`, `reused`, `retried`, and `failed`.
- **SC-003**: SDK-driven callers can invoke the command (or its AI tool form) without any terminal windows appearing.
- **SC-004**: Users invoking the original `worktree_create` and `worktree_delete` tools without new parameters see no behavior change from the pre-existing plugin.
- **SC-005**: Per-repo failures never silently corrupt the workspace: every failure is either accompanied by partial success in the response or is the whole-command rejection mandated by FR-009.
- **SC-006**: State stored across multiple per-project databases correctly reconstructs workspace membership for any `<name>` that the user has ever created from the same source `<cwd>`.

## Assumptions

- The source `<cwd>` layout is flat: the repos to be mirrored are direct children of `<cwd>`, not nested deeper.
- Each scanned repo is a valid git repository with at least one commit and a resolvable HEAD.
- The OpenCode SDK exposes stable `client.session.fork` and session resolution APIs that can be used to detect a stale workspace session.
- The target path `<cwd>/../worktrees/<name>/` lies on the same filesystem as the source repos (required for `git worktree`).
- `git fetch` is authorized for each repo in the current environment; fetch failures are treated as non-fatal warnings (they do not block worktree creation).
- Callers that use `/dev` in headless mode manage the returned session's lifecycle themselves.
- `postCreate` hooks are allowed to be long-running (e.g., package install), but must not produce irreversible side effects if the plugin retries them on reconciliation (hooks should be idempotent or tolerant of re-runs).
- The plugin does not reason about `localState.files`, overlay files, `workspace_delete`, dirty-worktree guards, `--force` mode, branch/baseBranch mismatch handling, or a global workspace registry. These were explicitly removed from MVP.
- The `/dev <name>` slash command is provided via an `.opencode/commands/dev.md` markdown file shipped by the plugin (OpenCode's standard custom-command convention). The plugin auto-creates this file on first activation alongside `.opencode/worktree.jsonc` (see FR-024). The markdown invokes the `worktree_workspace_create` AI tool with `name=$ARGUMENTS`, so both surfaces (slash command and direct AI tool call) exhibit equivalent behavior per FR-001.
- `.opencode/worktree.jsonc` is the per-repo source of truth for sync, hooks, and hook timeouts. Workspace-level configuration is intentionally out of scope for MVP.
