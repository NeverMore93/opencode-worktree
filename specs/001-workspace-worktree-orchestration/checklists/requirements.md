# Requirements Quality Checklist (Overview)

**Purpose**: Top-level requirement quality validation — completeness, clarity, consistency. Cross-cutting items only; deeper coverage lives in `state.md`, `contract.md`, `error.md`.
**Created**: 2026-04-17 (iteration-2)
**Feature**: [spec.md](../spec.md)
**Predecessor**: archived as `archive/2026-04-15-requirements-iteration-1.md` (9 of 40 resolved)
**Inputs**: iteration-1 still-open items + Explore agent independent gap analysis (codex stalled, not consulted this round)

## Requirement Completeness

- [ ] CHK001 Is the auto-detect scan behavior (FR-003) fully specified for edge cases: `.git` *file* (submodule reference) vs `.git` *directory* (normal repo), hidden directories, symlinked directories, and bare repos? [Completeness, Spec §FR-003, FR-022]
- [ ] CHK002 Is the per-repo `base_branch` capture moment explicitly defined (at scan time? after fetch? before pre-check)? [Completeness, Spec §FR-005, FR-006, FR-009]
- [ ] CHK003 Is the per-project database schema (WorkspaceMember fields, indexes, key columns supporting FR-021 reconstruction) enumerated at requirement level? [Completeness, Spec §FR-021, Key Entities]
- [ ] CHK004 Are the sync (`copyFiles`, `symlinkDirs`) and `postCreate` hook execution order documented within a single repo (sequential vs interleaved)? [Completeness, Spec §FR-010, FR-023]
- [ ] CHK005 Does the spec document where the `hooks.postCreate` timeout override lives in `.opencode/worktree.jsonc` (schema path)? [Completeness, Spec §FR-011]
- [ ] CHK006 Is FR-022's "git worktree list output includes the worktree path" requirement clear about what counts: trimmed path match, normalized path, or path-with-lock-file-presence? [Completeness, Spec §FR-022]

## Requirement Clarity

- [ ] CHK007 Does FR-022 distinguish whether `.git` file (submodule) and `.git` directory (normal repo) have identical health semantics, or whether submodules need additional validation? [Clarity, Spec §FR-022]
- [ ] CHK008 Is "compatible mirrored workspace" (implicit in FR-016 + FR-022) clearly disambiguated from "plugin-managed workspace" so reviewers and implementers do not conflate them? [Clarity, Spec §FR-016, FR-022]
- [ ] CHK009 Are FR-019 status values (`created`, `reused`, `retried`, `failed`) defined with mutually exclusive triggering conditions, including which conditions produce `retried` (FR-007 orphan vs FR-008 ghost prune)? [Clarity, Spec §FR-019, FR-007, FR-008]
- [ ] CHK010 Is the FR-002 name regex `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` documented with intent: does it intentionally exclude Unicode/emoji/dot-separated versions like `prd_1.v2`, or is that an oversight? [Clarity, Spec §FR-002]
- [ ] CHK011 Is the rationale for the 64-character `name` upper bound (FR-002) traceable to a concrete constraint (path length, branch length, UI cap)? [Clarity, Spec §FR-002]

## Requirement Consistency

- [x] CHK012 The spec references `/dev <name>` slash command in FR-001, User Story 1, and Acceptance Scenarios, but a new Assumption defers slash command registration. Is the spec consistent — do all slash references carry an explicit "AI tool only for now" qualifier? [Consistency, Conflict, Spec §FR-001, Assumptions, User Story 1] — **Resolved 2026-04-17**: Assumption rewritten to use `.opencode/commands/dev.md` (FR-024). All slash references are now valid; both surfaces are MVP.
- [x] CHK013 FR-001 requires "equivalent behavior" between slash and AI tool. With slash deferred, can equivalence be specified or validated at all? Is FR-001 still meaningful in MVP? [Consistency, Spec §FR-001, Assumptions] — **Resolved 2026-04-17**: Slash markdown delegates to AI tool with `name=$ARGUMENTS`, so equivalence is by construction.
- [ ] CHK014 Is the always-headless behavior of `/dev` (FR-018) consistent with the `headless` parameter semantics of legacy `worktree_create` (FR-020), so a reader does not assume the new tool inherits the legacy parameter? [Consistency, Spec §FR-018, FR-020]
- [ ] CHK015 Does the date-frozen branch naming rule (FR-005) remain consistent with FR-007 orphan retry and FR-008 ghost prune retry, both of which reuse the stored branch name on subsequent runs? [Consistency, Spec §FR-005, FR-007, FR-008]
- [ ] CHK016 Is FR-002's name validation regex consistent with FR-005's branch derivation: are there names that pass FR-002 but produce invalid git refs in FR-005 (e.g., trailing `-` in `name` combined with `_YYMMDD`)? [Consistency, Spec §FR-002, FR-005]

## Notes

- 16 items. Cross-references to `state.md`, `contract.md`, `error.md` for deep coverage.
- Slash deferral (CHK012, CHK013) is the highest-impact open issue this iteration; resolution likely requires a spec edit pass before `/speckit.plan`.
- See archived `archive/2026-04-15-requirements-iteration-1.md` for predecessor items already resolved (CHK001/010/012/017/020/030/034/035/036).
