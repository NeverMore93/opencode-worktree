# PR Description — 001-workspace-worktree-orchestration

Copy-paste target for the GitHub PR body. Reflects session 2026-04-13 through 2026-04-19.

---

## Title

`feat(worktree): ship /dev multi-repo workspace orchestration (FR-001..FR-024)`

## Summary

Introduces `/dev <name>` as a first-class slash command for creating or reconciling a multi-repo development workspace. Running `/dev prd_1` auto-detects git repos in the current directory, creates mirrored worktrees under `<cwd>/../worktrees/prd_1/<repo>/` on a date-stamped branch per repo, runs per-repo sync + `postCreate` hooks, and forks the current OpenCode session — all in one step, fully headless.

Both a slash command surface (via `.opencode/commands/dev.md`, auto-created by the plugin) and an AI tool (`worktree_workspace_create`) exist and are MVP-equivalent — the slash command delegates to the tool via `$ARGUMENTS` substitution.

## Motivation

Users working on PRDs that span multiple repos had to `git worktree add` by hand for each repo, resolve branch naming by convention, and fork sessions manually. The end-to-end setup took minutes and was error-prone. `/dev prd_1` collapses this to one command with consistent naming, partial-success semantics, and reconciliation on re-run.

This PR completes the spec-driven workflow tracked in `specs/001-workspace-worktree-orchestration/` — 24 functional requirements, 3 user stories, and 3 clarification sessions (2026-04-13, 04-14, 04-17). The final spec state has been analyzed for consistency (`/speckit.analyze` twice) and code has been aligned with independent code review (`pr-review-toolkit:code-reviewer`).

## Change highlights

### New capability — FR-024 auto-created slash command

- `src/plugin/worktree/dev-command.ts` (NEW) — `ensureDevCommand()` idempotently creates `.opencode/commands/dev.md` on plugin activation. Uses OpenCode's native custom-command convention (verified against `packages/opencode/src/config/command.ts:29` in the upstream OpenCode source).
- `src/plugin/worktree.ts` — wires `ensureDevCommand(directory, log)` into the plugin entry alongside the existing `loadWorktreeConfig` bootstrap.

### Multi-repo workspace orchestration — previously tracked as T004..T023

- `src/plugin/worktree/workspace.ts` — name validation (FR-002 regex), namespace conflict check against OpenCode built-in commands + existing `.opencode/commands/<name>.md`, auto-detect direct-child git repos, target path resolution with nesting rejection, per-path mutex.
- `src/plugin/worktree/workspace-create.ts` — branch-collision pre-check with FR-009 dual-path (whole-reject vs per-repo failed), reconcile planning with FR-022 health check + FR-007 orphan handling + FR-008 ghost prune, parallel worktree creation with FR-023 partial-rollback semantics, response assembly matching FR-019 schema.
- `src/plugin/worktree/workspace-session.ts` — single workspace-level session fork/reuse (FR-013/FR-014), always headless per FR-018.
- `src/plugin/worktree/state.ts` — extended with `workspace_associations` + `workspace_members` tables per FR-021 (per-project DB only, no global registry).

### Single-repo headless mode — US3

- `worktree_create` tool gains optional `repoPath` + `headless` parameters for SDK-driven callers; legacy behaviour preserved when both are unset (FR-020).

### Spec drift fixes applied 2026-04-19

Four drifts identified via literal-Grep audit against the 2026-04-17 spec and fixed:

1. **FR-005**: removed the iteration-2 `/`→`-` substitution rule (was unauthorised, caused silent collision between `feature/login` and `feature-login`).
2. **FR-005**: changed detached-HEAD SHA length from 8 to 12 hex chars (`--short=12`) for collision resistance.
3. **FR-009**: `checkBranchCollisions` refactored from `Result<void, CollisionError[]>` to `PreCheckOutcome { collisions, preCheckFailures }`, giving the caller both (a) whole-command reject on confirmed branch collision and (b) per-repo `status="failed"` on pre-check exception.
4. **T008 / H8**: added `checkWorkspaceNameAvailable` — rejects workspace names that collide with OpenCode built-in commands (`init`, `review`) or an existing `.opencode/commands/<name>.md` file (excluding our own FR-024 `dev.md`).

### Bonus fixes

- `CollisionError.push` used the wrong field key (`name` instead of the declared `repoName`); fixed for type consistency and correct rendering in rejection messages.
- Stale JSDoc in `planRepoWorktrees` still described the removed `/`→`-` rule and 8-char SHA; updated to reflect the 2026-04-17 spec.

## Testing

- **Static**: all four new / modified source entry points pass `bun build --target=bun --external '*'` with zero errors (full dependency chain resolves internally; external deps validated upstream in OCX monorepo).
- **Code review**: `pr-review-toolkit:code-reviewer` verified each of FR-005, FR-009, FR-019, FR-022, FR-024 against the implementation file:line with no unresolved issues after the stale-docstring fix.
- **Smoke tests**: full 10-scenario manual runbook at `specs/001-workspace-worktree-orchestration/context/go-live-runbook.md` — operator runs before merge.
- **Automated tests**: none in this facade repository; test harness lives in the OCX monorepo upstream.

## Spec alignment & audit trail

- `specs/001-workspace-worktree-orchestration/spec.md` — 24 FRs, 3 user stories, 3 clarification sessions documented in-file.
- `specs/001-workspace-worktree-orchestration/plan.md` — Constitution Check re-evaluated, risk register updated for FR-009 dual-path, integration flow shows current branch computation.
- `specs/001-workspace-worktree-orchestration/tasks.md` — T008 / T011 / T012 markers moved from `[需复审]` to `[已对齐 2026-04-19]` with fix notes; T024 marked `[x]`.
- `specs/001-workspace-worktree-orchestration/checklists/` — iteration-2 split into `requirements`, `state`, `contract`, `error`; iteration-1 archived. 8 of 51 items resolved; remainder are LOW-priority implementation detail.

## Known limitations

1. **Hot-reload of `.opencode/commands/dev.md`** — not explicitly verified. Worst case: user restarts OpenCode once after first plugin install, then `/dev` is recognised for all subsequent runs.
2. **Reserved command list is hard-coded** — `{init, review}` matches OpenCode `packages/opencode/src/command/index.ts:60-63` as of 2026-04-19. If upstream adds more built-in prompt commands, this list needs a manual update; a future refactor could query `client.command.list()` dynamically.
3. **No local test harness** — per repository contract, full test flow is upstream.

## Constitution compliance

Per `.specify/memory/constitution.md` v1.0.0:

- **I. Facade Fidelity**: ✅ new behaviour is additive; no claim in README that's not actually implemented.
- **II. Spec-Driven Change Control**: ✅ spec → clarify → checklist → plan → tasks → implement executed in that order; drift fixes applied in the same change that updated plan + tasks + checklists.
- **III. Additive Compatibility**: ✅ FR-020 preserves legacy `worktree_create` and `worktree_delete` unchanged; T020 retains the interactive terminal-and-fork path.
- **IV. Explicit State Ownership**: ✅ `workspace_associations` + `workspace_members` carry all workspace metadata; no directory-shape inference.
- **V. Directory Contract Hygiene**: ✅ new modules live under `src/plugin/worktree/` which has established `CLAUDE.md` coverage; new context note + runbook live under the feature directory.

## Reviewer checklist

- [ ] Smoke test scenarios S1–S10 all pass (see `go-live-runbook.md`)
- [ ] `/dev prd_1` in a test directory creates `worktrees/prd_1/<repo>` with expected branch names
- [ ] Second `/dev prd_1` reports `reused` for healthy members (no date re-roll)
- [ ] `/dev init` is rejected with clear namespace-conflict error
- [ ] Branch with `/` in name (e.g., HEAD on `feature/login`) yields `dev_feature/login_<name>_<date>` — slash preserved
- [ ] Detached HEAD yields 12-char SHA in branch name, not 8
- [ ] Legacy `worktree_create` behaviour unchanged
- [ ] `bun build` (with external deps installed) compiles cleanly
- [ ] Upstream OCX backport filed (if applicable)
