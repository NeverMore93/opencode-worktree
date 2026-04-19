# Go-Live Runbook — 001-workspace-worktree-orchestration

**Created**: 2026-04-19
**Purpose**: Operator runbook to validate and ship the workspace orchestration feature end-to-end after spec/plan/tasks alignment and code drift fixes. Use this to answer "is it actually ready?".

## Pre-Flight Checklist

- [x] Spec aligned with plan/tasks (2026-04-17 remediation + `/speckit.analyze` re-run)
- [x] 4 spec drifts fixed (2026-04-19): SHA[:12], no `/`→`-`, namespace check, FR-009 dual-path
- [x] 1 pre-existing bug fixed: `CollisionError.repoName` field name
- [x] T024 implemented: `dev-command.ts` + `ensureDevCommand` wired into plugin entry
- [x] Code review passed (`pr-review-toolkit:code-reviewer`, 1 stale-docstring finding resolved)
- [ ] Smoke test executed (see scenarios below)
- [ ] Changes committed to feature branch
- [ ] Upstream backport filed (if OCX monorepo is authoritative)

## Smoke Test Scenarios

All scenarios assume the plugin is loaded by OpenCode in a directory that contains ≥2 git repos as direct subdirectories. A convenient setup:

```bash
mkdir -p /tmp/wtree-smoke/repos
cd /tmp/wtree-smoke/repos
# Force main branch + set identity so commit --allow-empty succeeds regardless of global git config
git init -b main repoA && (cd repoA && git -c user.email=smoke@test -c user.name=smoke commit --allow-empty -m init)
git init -b main repoB && (cd repoB && git -c user.email=smoke@test -c user.name=smoke commit --allow-empty -m init)
cd /tmp/wtree-smoke/repos
opencode   # loads plugin via .opencode/plugin symlink, etc.
```

### S1 — FR-024 auto-create on first activation

**Given** the plugin is newly installed in `/tmp/wtree-smoke/repos`
**When** OpenCode starts and initialises the plugin
**Then** `/tmp/wtree-smoke/repos/.opencode/commands/dev.md` exists with the template content
**And** `cat .opencode/commands/dev.md` shows `description: ...` + `Use the worktree_workspace_create tool with name="$ARGUMENTS"`
**And** `client.command.list()` (e.g., via `/help`) shows `/dev` as a registered command

**Negative**: if the user manually edits `dev.md` and restarts OpenCode, the file stays intact (idempotent).

### S2 — US1 primary flow: `/dev prd_1`

**Given** `/tmp/wtree-smoke/repos` contains repoA (on `main`) and repoB (on `main`)
**When** the user types `/dev prd_1`
**Then** OpenCode substitutes `$ARGUMENTS` → `prd_1` and sends the command body to the LLM
**And** the LLM calls `worktree_workspace_create({ name: "prd_1" })`
**And** the tool creates:
- `/tmp/wtree-smoke/worktrees/prd_1/repoA` on branch `dev_main_prd_1_YYMMDD`
- `/tmp/wtree-smoke/worktrees/prd_1/repoB` on branch `dev_main_prd_1_YYMMDD`

**And** the tool forks the current session and returns:
```json
{
  "workspacePath": "/tmp/wtree-smoke/worktrees/prd_1",
  "sessionId": "<forked>",
  "sessionDisposition": "forked",
  "repos": [
    { "name": "repoA", "worktreePath": "...", "branch": "dev_main_prd_1_YYMMDD", "status": "created" },
    { "name": "repoB", "worktreePath": "...", "branch": "dev_main_prd_1_YYMMDD", "status": "created" }
  ],
  "warnings": []
}
```

**And** NO terminal window opens (headless always per FR-018).

### S3 — US2 reconcile: second `/dev prd_1`

**Given** S2 succeeded and the worktrees exist
**When** the user runs `/dev prd_1` a second time
**Then** both repos report `status = "reused"` and `sessionDisposition = "reused"`
**And** no date re-roll (branch names unchanged from S2)
**And** no worktree mutation

### S4 — Reconcile with one repo deleted

**Given** S2 succeeded
**When** the operator deletes `/tmp/wtree-smoke/worktrees/prd_1/repoA` directory manually
**And** the user runs `/dev prd_1`
**Then** repoA reports `status = "retried"` (orphan/missing recovery)
**And** repoB reports `status = "reused"`

### S5 — FR-005 no `/` substitution + preserved branch names

**Given** repoA's HEAD is on `feature/login` (slash in name)
**And** repos directory and dev command ready
**When** the user runs `/dev prd_1`
**Then** the repoA branch is exactly `dev_feature/login_prd_1_YYMMDD` (with `/` intact)
**And** `git branch --list` in repoA shows this branch exists and is currently checked out in `worktrees/prd_1/repoA`

### S6 — FR-005 detached HEAD uses SHA[:12]

**Given** repoB is in detached-HEAD state (e.g., `git checkout <sha>`)
**When** the user runs `/dev prd_1`
**Then** the repoB branch has the form `dev_<12-hex>_prd_1_YYMMDD`
**And** that hex prefix matches `git rev-parse --short=12 HEAD`

### S7 — Namespace conflict rejection (T008 / H8)

**Given** `repos/.opencode/commands/foobar.md` exists (user-defined custom command)
**When** the user tries `/dev foobar`
**Then** the tool returns error: `Workspace name "foobar" conflicts with an existing slash command at .../foobar.md. Either rename the workspace or remove the conflicting command file.`
**And** NO worktree is mutated
**And** NO dev.md is overwritten

**Variant**: `/dev init` or `/dev review` also returns conflict error citing OpenCode built-in.

### S8 — FR-009 (a) confirmed collision whole-reject

**Given** a separate git worktree is already checked out for branch `dev_main_prd_1_YYMMDD` at `/tmp/other-place/repoA` (externally created for test)
**When** the user runs `/dev prd_1` expecting that same branch
**Then** the entire command is rejected before any mutation
**And** the error message names `repoA`, the branch, and `/tmp/other-place/repoA`
**And** NO worktree is created even for repoB (whole-reject semantics)

### S9 — FR-009 (b) per-repo pre-check failure

**Given** repoA's `.git` directory has a permission issue making `git worktree list` fail
**When** the user runs `/dev prd_1`
**Then** repoA reports `status = "failed"` with error `pre-check failed: <reason>`
**And** repoB proceeds to `status = "created"` (other repos unaffected)
**And** the overall response is partial success (sessionId present)

### S10 — FR-023 partial-success preserves session fork

**Given** repoA has a `postCreate` hook that exits non-zero (simulated via `.opencode/worktree.jsonc` hook `exit 1`)
**When** the user runs `/dev prd_1`
**Then** repoA reports `status = "failed"` with hook error
**And** repoB reports `status = "created"`
**And** the session is still forked (step 3 proceeds despite step 2 partial failure)
**And** DB records are written ONLY for repoB

## Commit Plan

Recommended commit structure (2 logical commits):

### Commit 1 — Spec/plan/tasks alignment (2026-04-17 + 2026-04-19)

```
spec(001): finalize workspace orchestration — slash command via markdown, FR-009 dual-path, FR-005 no-sub SHA[:12]

- Clarifications Part 3 captures: slash via .opencode/commands/dev.md,
  FR-005 no `/` substitution, SHA[:12], FR-009 split, FR-023 partial
  rollback, FR-024 auto-create.
- Plan + tasks aligned in same change (Constitution Principle II).
- Archive iteration-1 checklist; generate iteration-2 (requirements,
  state, contract, error).
- 8/51 checklist items resolved, remainder LOW (implementation detail).

Files:
  specs/001-.../spec.md
  specs/001-.../plan.md
  specs/001-.../tasks.md
  specs/001-.../checklists/{requirements,state,contract,error}.md
  specs/001-.../checklists/archive/*.md
```

### Commit 2 — Implementation: FR-024 + drift fixes

```
feat(worktree): implement FR-024 /dev slash + fix 4 spec drifts

Adds:
- src/plugin/worktree/dev-command.ts: ensureDevCommand auto-creates
  .opencode/commands/dev.md idempotently (FR-024).
- src/plugin/worktree/workspace.ts: RESERVED_COMMAND_NAMES +
  checkWorkspaceNameAvailable for T008 / H8 namespace conflict check.
- src/plugin/worktree/workspace-create.ts: PreCheckOutcome +
  PreCheckFailure types; checkBranchCollisions dual-path (FR-009 (a)
  whole-reject + (b) per-repo failed); orchestrator step 1b + step 7
  updated.

Fixes:
- FR-005: remove unauthorised iteration-2 `/`→`-` substitution.
- FR-005: detached HEAD SHA[:8] → SHA[:12] (--short=8 → --short=12).
- FR-009: pre-check failure on single repo surfaces as per-repo failure
  instead of throwing, per 2026-04-17 spec.
- CollisionError push: pre-existing bug `name` field → `repoName` to
  match the declared interface; no behavioural change for callers.
- planRepoWorktrees docstring: removed stale mention of `/` substitution
  and 8-char SHA (found by pr-review-toolkit:code-reviewer).

Wires ensureDevCommand into WorktreePlugin entry alongside loadWorktreeConfig.

Refs: spec FR-005, FR-009, FR-019, FR-022, FR-023, FR-024;
       tasks T008, T011, T012, T024 (previously marked [需复审]).
```

**Note on gpg/hooks**: The repository does not ship a pre-commit hook per `.gitignore`/`.git/hooks` state; use default `git commit -S` if signing is required by the host. Do NOT `--no-verify` unless explicitly authorised.

## Known Limitations (surfaced during implementation)

### L1 — Hot-reload of `.opencode/commands/dev.md` not verified
After first plugin activation writes `dev.md`, the OpenCode instance may not auto-detect the new file without restart. If smoke test S1 fails to show `/dev` in `/help` without restart, document this as a one-time manual step: restart OpenCode after first plugin install.

### L2 — Reserved command list is hard-coded
`RESERVED_COMMAND_NAMES = { "init", "review" }` reflects OpenCode `packages/opencode/src/command/index.ts:60-63` as of 2026-04-19. If OpenCode adds more built-in commands upstream, this list must be updated by hand. Future improvement: query `client.command.list()` dynamically in `checkWorkspaceNameAvailable`.

### L3 — No automated test suite in this facade repo
Per repository README / CLAUDE.md: the full test workflow lives in the upstream OCX monorepo. This runbook's smoke tests are the only local validation. TypeScript compile is implicit (no tsconfig in facade; upstream verifies).

### L4 — Session fork assumes SDK stability
FR-013/FR-014 rely on `client.session.fork({ sessionID })` resolving correctly and `session.idle` being reliable. If the upstream SDK changes semantics, reconcile behaviour may degrade silently.

## Rollback Plan

If smoke tests reveal a blocking issue:

1. **Revert the implementation commit** (`git revert <commit-2>`), keep the spec/plan/tasks commit (`commit-1`). The spec alignment is correct and useful even without code.
2. **File a bug** in specs/001-.../context/ naming the failing scenario.
3. **Re-open** `/speckit.clarify` to resolve the ambiguity that led to incorrect implementation.

If the issue is spec-level (not implementation):

1. **Revert both commits** to the previous aligned state.
2. **File correction** via new `/speckit.specify` session or targeted edit of spec Clarifications.

## Sign-off Criteria

- [ ] S1–S10 all pass OR failures documented with root cause + issue link
- [ ] Operator confirms: "I can type `/dev <name>` and see workspace created with session fork"
- [ ] No permanent changes to source repos (`git status` in repoA/repoB clean after smoke test)

When all boxes are checked, the feature is ready for upstream backport.
