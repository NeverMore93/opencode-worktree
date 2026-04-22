# State Management Quality Checklist

**Purpose**: Validate requirement quality for state machine, persistence, reconciliation, and crash safety. FR-005, FR-007, FR-013, FR-014, FR-015, FR-021, FR-022, FR-023.
**Created**: 2026-04-17 (iteration-2)
**Feature**: [spec.md](../spec.md)
**Sister checklists**: `requirements.md` (overview), `contract.md` (API), `error.md` (failure modes)

## Branch Naming State

- [ ] CHK001 Is the stored branch name's lifecycle explicit at requirement level: written when (FR-005 first create), read when (FR-007/008 retry), deleted when (never? on workspace deletion?), garbage-collected when? [Completeness, Spec §FR-005, FR-021]
- [ ] CHK002 Does FR-005's "frozen date on first create" rule define its scope when an orphan retry happens *on the same day* as the original first-create — does the date stay frozen at the original, or could it inadvertently re-roll? [Clarity, Spec §FR-005, FR-007]
- [ ] CHK003 Does FR-005 specify behavior when the source `base_branch` (e.g., `main`) was renamed *after* first create but *before* a reconciliation run — does the stored branch name still apply? [Coverage, Gap, Spec §FR-005]

## Session State

- [ ] CHK004 Is "stale workspace session" (FR-014) defined with concrete SDK error signals (which API call, which error class) rather than narrative description? [Clarity, Spec §FR-014]
- [ ] CHK005 Is session-binding validation required before reuse (i.e., the plugin must call SDK to verify the ID resolves), or is mere presence in DB sufficient? [Coverage, Gap, Spec §FR-013, FR-014]
- [ ] CHK006 Are requirements defined for the case where the SDK is unreachable during stale-check (network down, daemon offline) — does reuse default to "assume valid" or "assume stale"? [Coverage, Gap, Spec §FR-014]

## Reconciliation & Orphans

- [ ] CHK007 Does FR-007 specify the atomic boundary for orphan recovery: if directory removal succeeds but recreation fails, what is the resulting `status` and recoverable state? [Coverage, Gap, Spec §FR-007]
- [ ] CHK008 Does FR-007 define a retry limit or escalation path when orphan recreation repeatedly fails (e.g., disk full, permission denied)? [Coverage, Gap, Spec §FR-007]
- [ ] CHK009 Does FR-007's orphan detection window distinguish "broken from prior failed run" (FR-015 scenario) from "corrupted mid-operation" (interrupted current run)? [Coverage, Gap, Spec §FR-007, FR-015]
- [ ] CHK010 Are requirements defined for cross-run consistency when a repo is added to or removed from `<cwd>` between runs (does the orphan from a removed repo get cleaned up, or persist forever)? [Coverage, Spec §User Story 2, Edge Cases]

## Mutation Ordering & Crash Safety

- [x] CHK011 Does FR-023's mutation ordering specify partial-rollback semantics: if step 2 (parallel worktree creation) has 2 of 3 repos succeed and 1 fail, does the command proceed to step 3 (fork session) for the 2 successes, or abort all? [Consistency, Gap, Spec §FR-023, FR-012] — **Resolved 2026-04-17**: FR-023 explicitly specifies continue-on-partial-failure: failed repos marked `status="failed"` with mandatory `error`, step 3 fork proceeds, step 4 writes DB only for successful repos. Overall response is partial success.
- [ ] CHK012 Does FR-023 specify a window/orphan handling for the gap between step 2 (worktrees created on disk) and step 4 (DB writes): if a crash occurs between step 3 (fork) and step 4 (DB write), the worktrees are on disk but no DB record exists — does FR-007 reliably detect and recover this? [Consistency, Spec §FR-023, FR-007, FR-015]
- [ ] CHK013 Does FR-023 specify a timeout or liveness requirement for step 2 (parallel create + sync + hooks) so a hung `git fetch` or stuck hook does not block the entire command indefinitely? [Coverage, Gap, Spec §FR-023, FR-011]
- [ ] CHK014 Is per-project DB write atomicity specified within step 4: if writing 3 member records, what guarantees that all 3 succeed or none (e.g., transaction)? [Coverage, Gap, Spec §FR-021, FR-023]

## Notes

- 14 items. Hot zone for risk per Explore agent: FR-022 health semantics, FR-007 orphan boundaries, FR-023 partial rollback.
- CHK011 (partial rollback) is highest priority — FR-023 is silent on this and FR-012 partial-success principle creates ambiguity.
