# Error Handling Quality Checklist

**Purpose**: Validate requirement quality for failure modes, partial success, recovery, and observability. FR-006, FR-008, FR-009, FR-011, FR-012, FR-015.
**Created**: 2026-04-17 (iteration-2)
**Feature**: [spec.md](../spec.md)
**Sister checklists**: `requirements.md` (overview), `state.md` (state machine), `contract.md` (API)

## git Failure Modes

- [ ] CHK001 Are `git fetch` failure modes (network unreachable, auth failure, partial fetch, ref pruning conflict) classified into `warning` vs `fatal` with explicit requirement statements? [Coverage, Gap, Spec §FR-006, Assumptions]
- [ ] CHK002 Are requirements defined for `git worktree prune` itself failing during ghost recovery (disk error, lock held, concurrent prune)? [Edge Case, Gap, Spec §FR-008]
- [ ] CHK003 Does FR-009 pre-check phase mitigate the race where another process adds a conflicting branch *between* pre-check and the actual `git worktree add` — and if not, what is the per-repo error reporting requirement? [Coverage, Gap, Spec §FR-009]
- [ ] CHK004 Does FR-009 cover the case where the source `base_branch` (e.g., `main`) is deleted between pre-check and `git worktree add -b dev_main_... main` — what error class surfaces? [Edge Case, Gap, Spec §FR-009, FR-005]

## Pre-Check Atomicity

- [ ] CHK005 Is the FR-009 error payload required to include all three of: conflicting repo name, target branch name, and external worktree path — so the user can immediately remediate? [Completeness, Spec §FR-009]
- [x] CHK006 Does FR-009 specify what happens to per-repo state if the pre-check itself partially fails (e.g., `git worktree list` succeeds for 2 repos, fails for 1) — abort the whole command, or treat the unreadable repo as conflict-free? [Coverage, Gap, Spec §FR-009, FR-022] — **Resolved 2026-04-17**: FR-009 now distinguishes "confirmed branch collision" (whole-command reject) from "pre-check failure on a single repo" (per-repo `status="failed"`, others continue). Whole-command reject reserved for confirmed collisions only.

## Hooks & Timeouts

- [ ] CHK007 Are partial hook output / log-preservation requirements defined when `postCreate` times out mid-execution (FR-011)? Does the user get the partial stdout/stderr in the `error` field? [Edge Case, Gap, Spec §FR-011, FR-019]
- [ ] CHK008 Is behavior defined when the hook timeout configuration in `.opencode/worktree.jsonc` is malformed (negative, non-numeric, missing key)? Default to FR-011's 30 minutes silently, or surface a config error? [Edge Case, Gap, Spec §FR-011]
- [ ] CHK009 Are observability requirements defined (progress logs, periodic heartbeat) for long-running `postCreate` hooks so users can diagnose hung operations before the 30-minute timeout? [Gap, Non-Functional, Spec §FR-011]

## Filesystem & Permissions

- [ ] CHK010 Are requirements defined for `/dev` invoked when `<cwd>/..` is not writable (parent permission), per FR-004 path resolution? [Edge Case, Gap, Spec §FR-004]
- [ ] CHK011 Are requirements defined for partial filesystem failure during sync (e.g., disk full while `sync.copyFiles` runs) — does the repo report `failed`, or partial success with warning? [Edge Case, Gap, Spec §FR-010, FR-019]
- [ ] CHK012 Does the spec require detection + meaningful error when `<cwd>` and target path are on different filesystems (Assumption violation: `git worktree` requires same FS)? [Coverage, Gap, Spec §Assumptions]

## Recovery & Retry

- [ ] CHK013 Does FR-007 specify retry limits or escalation when orphan recreation repeatedly fails for the same repo across reconciliation runs (avoid infinite retry loop on persistent disk error)? [Coverage, Gap, Spec §FR-007]
- [ ] CHK014 Are requirements defined for fork-failure error reporting (FR-015): does the response include the list of retained-but-unmanaged worktree paths so the user can clean them up, or just a generic error? [Completeness, Spec §FR-015, FR-019]

## Observability & Auth

- [ ] CHK015 Is `git fetch` authorization (Assumption) treated as a graceful-degradation requirement: does the plugin succeed without credentials by treating fetch failure as warning, or hard-fail? [Assumption, Gap, Spec §FR-006, Assumptions]
- [ ] CHK016 Does the spec require structured logging at requirement level (correlation IDs per `<name>` invocation, per-repo span markers) so failures can be diagnosed across the parallel-execution phase (FR-023 step 2)? [Gap, Non-Functional, Spec §FR-023]

## Notes

- 16 items. Concentrated on FR-007/009/011/015 — these are the failure-prone surfaces. CHK001 and CHK008 are particularly likely to bite real users early.
- CHK006 (pre-check partial failure) is a previously unseen gap surfaced by Explore agent.
