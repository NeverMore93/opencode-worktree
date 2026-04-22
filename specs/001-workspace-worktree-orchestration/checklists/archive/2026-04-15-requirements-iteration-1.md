# Requirements Quality Checklist: Workspace-Level Worktree Orchestration

**Purpose**: Validate requirement quality post-rewrite. Weighted toward Error Handling and State Management hotspots. Consumers are spec author and plan maker.
**Created**: 2026-04-14
**Updated**: 2026-04-15 (aligned with spec.md Part 2)
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [x] CHK001 Is the `/dev <name>` argument grammar fully specified, including accepted character set, length bounds, and reserved names? [Completeness, Spec §FR-002] — **Resolved 2026-04-15**: FR-002 now specifies `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`.
- [ ] CHK002 Are per-project database schema fields (WorkspaceMember, stored branch, timestamps, status, orphan indicators) enumerated in a way that supports reconciliation? [Completeness, Spec §FR-021, Key Entities]
- [ ] CHK003 Is the response `warnings` array content contract specified (trigger conditions, format, ordering) for non-plugin-managed target content? [Completeness, Spec §FR-016, FR-019]
- [ ] CHK004 Are the sync and `postCreate` hook execution order and parallelism requirements documented (per-repo sequential vs interleaved)? [Completeness, Spec §FR-007, FR-010]
- [ ] CHK005 Does the spec document where and how `hooks.postCreate` timeout is declared per repo (schema path inside `.opencode/worktree.jsonc`)? [Completeness, Spec §FR-011]
- [ ] CHK006 Are the slash command `/dev` and AI tool `worktree_workspace_create` mapped with exact parameter and response equivalence requirements? [Completeness, Spec §FR-001]
- [ ] CHK007 Is the per-repo `base_branch` capture moment explicitly defined (at scan time? at first add? before or after fetch)? [Completeness, Spec §FR-005, FR-006]
- [ ] CHK008 Is the auto-detect repo scan behavior fully specified: what qualifies as a git repo, how `.git` files (submodules, worktrees) are handled, and whether hidden directories are scanned? [Completeness, Spec §FR-003]
- [ ] CHK009 Is the `/dev <name>` slash command registration mechanism documented (plugin command vs tool, how it maps to `worktree_workspace_create`)? [Completeness, Spec §FR-001]

## Requirement Clarity

- [x] CHK010 Is "healthy worktree" defined with objective criteria (filesystem + `.git` state + `git worktree list` presence)? [Clarity, Spec §User Story 2] — **Resolved 2026-04-15**: FR-022 defines healthy as dir exists + `.git` entry + listed in `git worktree list`.
- [ ] CHK011 Is "stale workspace session" defined with concrete SDK signals (which API, which error class)? [Clarity, Spec §FR-014]
- [x] CHK012 Are "shell metacharacters" in name validation enumerated rather than left to interpretation? [Clarity, Spec §FR-002] — **Resolved 2026-04-15**: FR-002 now uses a positive allowlist regex; metacharacters are excluded by construction.
- [ ] CHK013 Is "unrelated root-level content" in the target directory defined with measurable criteria (what files count, hidden files included)? [Clarity, Spec §FR-016]
- [ ] CHK014 Are the four `status` values (`created`, `reused`, `retried`, `failed`) each defined with exact triggering conditions and mutual exclusivity? [Clarity, Spec §FR-019]
- [ ] CHK015 Is "fork session failed" defined with concrete failure signals from the SDK (distinct from network timeout, auth, etc.)? [Clarity, Spec §FR-015]
- [ ] CHK016 Is "compatible mirrored workspace" (implicitly present through FR-016) clearly disambiguated from "plugin-managed workspace" (no metadata check in simplified spec)? [Clarity, Consistency, Spec §FR-016]

## Requirement Consistency

- [x] CHK017 Does FR-009 (Scenario B whole-command reject) correctly override the partial-success principle in FR-012 and User Story 1 Scenario 2? [Consistency, Spec §FR-009, FR-012] — **Resolved 2026-04-15**: FR-009 now explicitly specifies a pre-check phase before any mutations, guaranteeing "no worktrees created for any repo".
- [ ] CHK018 Is the always-headless behavior of `/dev` consistent with the `headless` parameter semantics of legacy `worktree_create`? [Consistency, Spec §FR-018, FR-020]
- [ ] CHK019 Does the branch-naming rule (FR-005, date frozen on first create) remain consistent with FR-008 (ghost prune + retry reuses stored branch)? [Consistency, Spec §FR-005, FR-008]
- [x] CHK020 Does FR-015 (fork failure retention, no DB write) align with FR-021 (state reconstruction from per-project DB) when orphan worktrees exist? [Consistency, Spec §FR-015, FR-021] — **Resolved 2026-04-15**: FR-007 now explicitly requires orphan dir removal and recreation; FR-023 establishes write ordering.
- [ ] CHK021 Are the `/dev` slash and the AI tool `worktree_workspace_create` consistently described as "equivalent behavior" without drift in error-reporting surface? [Consistency, Spec §FR-001]

## Acceptance Criteria Quality

- [ ] CHK022 Can "5+ repos in under 30 seconds" (SC-001) be measured objectively given varying network speeds and `postCreate` hook cost? [Measurability, Spec §SC-001]
- [ ] CHK023 Is SC-002's 15-second reconciliation target defined when partial failures occur (does timer include the failed repo's retry)? [Measurability, Spec §SC-002]
- [ ] CHK024 Is SC-005's "never silently corrupts" verifiable by inspection of response contract? [Measurability, Spec §SC-005, FR-019]
- [ ] CHK025 Is SC-006's "correctly reconstructs workspace membership" verifiable without extra tooling (query shape, expected fields)? [Measurability, Spec §SC-006, FR-021]

## Error Handling Coverage

- [ ] CHK026 Are requirements defined for `git fetch` failure modes (network out, auth failure, partial fetch) and their warning vs fatal classification? [Coverage, Gap, Spec §FR-006, Assumptions]
- [ ] CHK027 Is the error payload for Scenario B (live-worktree branch collision) specified to include both conflicting path and the branch in question? [Coverage, Spec §FR-009]
- [ ] CHK028 Are requirements defined for `git worktree prune` itself failing during ghost recovery (disk error, lock held)? [Edge Case, Gap, Spec §FR-008]
- [ ] CHK029 Are partial hook output / logging requirements defined when `postCreate` times out mid-execution? [Edge Case, Gap, Spec §FR-011]
- [x] CHK030 Is the per-repo `failed` status required to carry a machine-readable error code in addition to human message? [Coverage, Spec §FR-019] — **Resolved 2026-04-15**: FR-019 now includes `error?: string` (human-readable) on per-repo objects when `status = "failed"`. Machine-readable error codes deferred to implementation.
- [ ] CHK031 Are requirements defined for `/dev` being invoked when `<cwd>/..` path is not writable (parent permission)? [Edge Case, Gap, Spec §FR-004]
- [ ] CHK032 Is behavior defined when hook timeout configuration in `.opencode/worktree.jsonc` is malformed or negative? [Edge Case, Gap, Spec §FR-011]

## State Management Coverage

- [ ] CHK033 Is the stored branch name's lifecycle explicit (written when, read when, deleted when, garbage-collected when)? [Coverage, Spec §FR-005, FR-021]
- [x] CHK034 Are requirements defined for reconciliation when the stored branch was manually deleted (`git branch -D`) from the source repo? [Edge Case, Gap, Spec §FR-005, FR-007] — **Resolved 2026-04-15**: FR-005 now explicitly states the stored branch is recreated via `git worktree add -b`.
- [x] CHK035 Is per-project DB write ordering vs filesystem mutation explicit (worktree added first? or DB member written first?) to prevent inconsistency on crash? [Gap, Spec §FR-015, FR-021] — **Resolved 2026-04-15**: FR-023 defines ordering: worktrees → session fork → member writes.
- [x] CHK036 Are orphan detection requirements defined (worktree on disk but no DB record — e.g., after FR-015 fork failure)? [Coverage, Spec §FR-015] — **Resolved 2026-04-15**: FR-007 now requires orphan dir removal and recreation with `status = "retried"`.
- [ ] CHK037 Is session binding validation required before reuse (call SDK to verify ID resolves), or only presence in DB? [Coverage, Spec §FR-013, FR-014]
- [ ] CHK038 Are requirements defined for cross-run consistency when a repo is removed from `<cwd>` between runs (skipped silently vs stale DB member)? [Coverage, Spec §User Story 2, Edge Cases]

## Non-Functional & Dependencies

- [ ] CHK039 Are observability requirements (progress, logs) defined for long-running `postCreate` hooks so users can diagnose hung operations? [Gap, Non-Functional]
- [ ] CHK040 Is the assumption that `git fetch` is authorized validated in the requirements (does the plugin fail gracefully without credentials)? [Assumption, Spec §Assumptions, FR-006]
- [ ] CHK041 Is the assumption of "same filesystem" (required for `git worktree`) surfaced with detection + error messaging requirements? [Assumption, Dependency, Spec §Assumptions]
- [ ] CHK042 Are requirements defined for idempotency of `postCreate` hooks (the spec assumes hooks tolerate re-runs but does not require it be asserted)? [Assumption, Spec §Assumptions, FR-010]

## Notes

- Total items: 42. Distribution: Completeness 9, Clarity 7, Consistency 5, Acceptance 4, Error Coverage 7, State Coverage 6, Non-Functional 4.
- Error + State coverage = 13 items (hotspot per risk distribution).
- Items marked `[Gap]` indicate probable missing requirements that should be addressed before implementation.
- Items marked `[Clarity]` indicate existing requirements that need tightening.
- Each item should be marked `[x]` after resolution in spec or explicitly accepted as out-of-scope.
- Checklist aligned with spec.md Part 2 (2026-04-14): all `localState.files`, `mismatch`, `workspace_delete`, and global registry items have been removed.
