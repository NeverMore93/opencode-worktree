# Specification Quality Checklist: Workspace-Level Worktree Orchestration

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-03-28
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- All items pass validation.
- Spec references `client.session.fork()` in Assumptions — this is an external dependency reference, not an implementation detail, and is acceptable.
- Ready for `/speckit.clarify` or `/speckit.plan`.

## Requirement Completeness

- [ ] CHK001 Are per-repo reconciliation result requirements defined for every expected outcome class such as `created`, `reused`, `retried`, and `failed`? [Completeness, Spec §User Story 1, Spec §FR-015]
- [ ] CHK002 Does the spec define what makes an existing target directory a "compatible mirrored workspace" rather than an incompatible directory that must be rejected? [Clarity, Ambiguity, Spec §FR-010]
- [ ] CHK003 Are requirements specified for how `worktree_workspace_create` should behave when repeated execution targets an existing workspace whose session binding is missing or stale? [Gap, Spec §FR-003, Spec §FR-015]
- [ ] CHK004 Are the required response fields specified for both first-time creation and reconciliation runs, including workspace-level and per-repo result metadata? [Completeness, Spec §User Story 1, Spec §FR-003, Spec §FR-015]

## Requirement Clarity

- [ ] CHK005 Is "healthy existing member" defined with explicit criteria instead of relying on interpretation? [Ambiguity, Spec §User Story 1, Spec §FR-015]
- [ ] CHK006 Are "missing member" and "previously failed member" defined in a way that can be objectively distinguished during reconciliation? [Clarity, Spec §FR-015, Key Entities]
- [ ] CHK007 Is the phrase "compatible mirrored workspace" backed by concrete validation rules for filesystem layout and persisted state? [Clarity, Spec §FR-010, Key Entities]
- [ ] CHK008 Are workspace-session terms such as "returned", "managed through SDK", and "headless" used consistently between the functional requirements and assumptions? [Consistency, Spec §FR-003, Spec §FR-013, Assumptions]

## Requirement Consistency

- [ ] CHK009 Do the partial-success requirements stay consistent when some repo members are reused while others are newly created or retried? [Consistency, Spec §FR-004, Spec §FR-015]
- [ ] CHK010 Are the acceptance scenarios for existing target workspaces aligned with the updated reconciliation requirements and no longer dependent on the old "directory must not exist" rule? [Consistency, Spec §User Story 1, Spec §FR-010, Spec §FR-015]
- [ ] CHK011 Is the single workspace-session model fully aligned with the workspace-member model so no requirement still implies per-repo session creation? [Consistency, Spec §FR-003, Spec §FR-014, Key Entities]

## Acceptance Criteria Quality

- [ ] CHK012 Can reviewers objectively determine from the spec when a repeated `worktree_workspace_create` call should fork a new workspace session versus reuse an existing one? [Gap, Spec §FR-003, Spec §FR-015]
- [ ] CHK013 Are success criteria measurable for reconciliation runs, not only for first-time workspace creation? [Measurability, Gap, Spec §SC-001, Spec §SC-002]

## Scenario Coverage

- [ ] CHK014 Are requirements defined for branch or `baseBranch` mismatches between an existing healthy member and a new reconciliation request? [Gap, Spec §FR-001, Spec §FR-015]
- [ ] CHK015 Are repeated headless-create scenarios covered when the target workspace already exists and has an active or stale workspace session? [Gap, Spec §FR-013, Assumptions]
- [ ] CHK016 Are requirements specified for reconciliation when filesystem state and persisted workspace-member state disagree? [Gap, Key Entities, Assumptions]

## Edge Case Coverage

- [ ] CHK017 Are concurrent reconciliation requirements specific about locking scope, loser behavior, and the caller-visible error/result contract? [Clarity, Spec §Edge Cases]
- [ ] CHK018 Are requirements defined for target workspaces that partially match the expected layout but also contain unmanaged or foreign content? [Gap, Spec §FR-010]

## Non-Functional Requirements

- [ ] CHK019 Are performance expectations defined separately for initial create versus repeated reconcile across 5+ repos? [Gap, Spec §SC-001]

## Dependencies & Assumptions

- [ ] CHK020 Is the assumption that per-project databases can safely reconstruct reconciliation state across a shared workspace explicitly validated in the requirements? [Assumption, Key Entities, Assumptions]

## Requirement Completeness

- [ ] CHK021 Are the required per-repo reconciliation result fields defined for `mismatch` outcomes, not just generic success/failure cases? [Completeness, Spec §User Story 1, Spec §FR-016]
- [ ] CHK022 Does the spec define whether the response explicitly indicates when the workspace session was `reused` versus newly forked? [Completeness, Spec §FR-017, Gap]
- [ ] CHK023 Are local-only overlay file configuration requirements defined precisely enough for authors to know where and how such files are declared? [Gap, Spec §FR-018, Key Entities]

## Requirement Clarity

- [ ] CHK024 Is "stale session binding" defined with concrete validation criteria rather than implementation intuition? [Ambiguity, Spec §FR-017, Assumptions]
- [ ] CHK025 Is "compatible mirrored workspace" defined with objective structural or metadata checks that distinguish it from unmanaged directories? [Clarity, Spec §FR-010]
- [ ] CHK026 Are the boundaries between existing sync settings (`copyFiles` / `symlinkDirs`) and the new local-only overlay semantics explicit and non-overlapping? [Consistency, Spec §FR-012, Spec §FR-018, Assumptions]

## Acceptance Criteria Quality

- [ ] CHK027 Can reviewers objectively verify from the spec when repeated `worktree_workspace_create` should return the same `sessionId` versus a newly forked one? [Measurability, Spec §User Story 1, Spec §FR-017]
- [ ] CHK028 Are overlay-file requirements measurable enough to tell whether rematerialization happened after both initial create and reconciliation runs? [Measurability, Spec §User Story 1, Spec §FR-018, Spec §FR-019]

## Scenario Coverage

- [ ] CHK029 Are requirements defined for repeated headless reconciliation when the target workspace has a stale session binding that must be replaced? [Coverage, Gap, Spec §FR-013, Spec §FR-017]
- [ ] CHK030 Are requirements specified for local-only overlay files during reconciliation when the existing worktree contains branch-tracked content that differs from the desired local overlay content? [Coverage, Spec §FR-018, Spec §FR-019]

## Edge Case Coverage

- [ ] CHK031 Are conflict requirements defined when a path is configured simultaneously as a local-only overlay file and as a normal sync target (`copyFiles` or `symlinkDirs`)? [Gap, Conflict, Spec §FR-012, Spec §FR-018]
- [ ] CHK032 Are requirements specified for overlay rematerialization failures beyond symlink fallback, such as missing local source content or permission-denied writes? [Edge Case, Gap, Spec §FR-019]

## Requirement Completeness

- [ ] CHK033 Are the allowed `localState.files` path formats fully specified, including whether entries are repo-relative only and whether directories or glob patterns are intentionally excluded? [Completeness, Spec §FR-018, Key Entities]
- [ ] CHK034 Does the spec define the source of truth for the content rematerialized from `localState.files`, rather than only saying a "local version" is restored? [Gap, Spec §User Story 1, Spec §FR-018, Spec §FR-019]
- [ ] CHK035 Is it explicit whether single-repo `worktree_create` also consumes `localState.files`, or whether repo-local state rematerialization is intentionally limited to `worktree_workspace_create`? [Gap, Spec §FR-006, Spec §FR-018]

## Requirement Clarity

- [ ] CHK036 Is the ordering between checkout/reconcile, `sync` application, hooks, and `localState.files` rematerialization explicit enough to avoid multiple valid interpretations? [Clarity, Spec §User Story 1, Spec §FR-012, Spec §FR-018]
- [ ] CHK037 Are terms such as "local version", "local-state content", and "local-state source content" normalized so reviewers can tell they refer to one canonical concept? [Ambiguity, Spec §User Story 1, Spec §FR-019, Assumptions]

## Requirement Consistency

- [ ] CHK038 Do the clarifications, functional requirements, key entities, and edge cases consistently use `localState.files` terminology rather than mixing it with earlier "overlay" wording? [Consistency, Spec §Clarifications, Spec §FR-018, Spec §Edge Cases]
- [ ] CHK039 Are the boundaries between `localState.files` and `sync` consistent across the user story narrative, FR-023, and the assumptions section? [Consistency, Spec §User Story 1, Spec §FR-023, Assumptions]

## Acceptance Criteria Quality

- [ ] CHK040 Can reviewers objectively determine from the spec which per-repo `status` should be returned when `localState.files` rematerialization fails after a worktree was otherwise created, retried, or reused? [Measurability, Spec §FR-019, Spec §FR-021]

## Scenario Coverage

- [ ] CHK041 Are requirements defined for repeated reconciliation when the declared `localState.files` set itself changes between runs for the same repo? [Coverage, Gap, Spec §FR-018, Spec §FR-019]

## Dependencies & Assumptions

- [ ] CHK042 Is the assumption that `localState.files` remains repo-scoped rather than workspace-scoped explicitly validated for multi-repo workspaces where each repo may declare a different local-state set? [Assumption, Key Entities, Assumptions]

## Requirement Completeness

- [ ] CHK043 Are requirements defined for reconciliation requests that omit previously managed workspace members from a compatible target workspace, including whether those omitted members are preserved, ignored, or surfaced as drift? [Coverage, Gap, Spec §FR-015, Key Entities]
- [ ] CHK044 Does the spec define the required caller-visible response contract for `worktree_workspace_delete`, including whether per-repo outcomes, partial failures, and final workspace cleanup status must be returned? [Completeness, Gap, Spec §User Story 3, Spec §FR-009]
- [ ] CHK045 Are requirements specified for deleting a managed workspace when some member records or project databases are missing, stale, or only partially recoverable from persisted metadata? [Coverage, Gap, Spec §User Story 3, Key Entities, Assumptions]

## Requirement Clarity

- [ ] CHK046 Is it explicit whether single-repo `worktree_create.repoPath` must be relative to `ctx.directory`, relative to a source workspace root, or may be absolute? [Clarity, Spec §User Story 2, Spec §FR-005]
- [ ] CHK047 Are the authoritative identity fields for a `WorkspaceMember` across pooled databases defined clearly enough to avoid ambiguity between `repoPath`, `projectId`, source-workspace identity, and worktree path? [Clarity, Spec §FR-008, Key Entities]

## Requirement Consistency

- [ ] CHK048 Do the requirements consistently distinguish single-repo headless no-session behavior from workspace headless forked-session behavior across user stories, functional requirements, and assumptions? [Consistency, Spec §User Story 1, Spec §User Story 2, Spec §FR-006, Spec §FR-013, Assumptions]
- [ ] CHK049 Is the intended relationship between workspace-created members and the existing single-repo `worktree_delete` flow defined consistently, so lifecycle ownership is not left implicit? [Consistency, Gap, Spec §FR-009, Spec §SC-004]

## Acceptance Criteria Quality

- [ ] CHK050 Can reviewers objectively determine from the spec what should happen when workspace-session fork succeeds but every requested repo member ultimately reports `failed`? [Measurability, Gap, Spec §FR-003, Spec §FR-004, Spec §FR-021]
- [ ] CHK051 Are the requirements measurable enough for SDK callers to know whether the per-repo results array must preserve request ordering or provide another stable correlation mechanism? [Acceptance Criteria, Gap, Spec §FR-021, Spec §User Story 1]
- [ ] CHK052 Can reviewers objectively determine whether `worktree_workspace_delete` completed correctly when cleanup is best-effort and some members fail after others have already been removed? [Measurability, Spec §User Story 3, Spec §Edge Cases, Spec §SC-005]

## Scenario Coverage

- [ ] CHK053 Are requirements defined for cross-project state lookup after one managed workspace has been deleted while another remains active, so grouping and cleanup isolation can be verified without inference? [Coverage, Spec §User Story 4, Spec §SC-006]
- [ ] CHK054 Are repeated create/delete/create scenarios covered for the same target directory, including what metadata must be cleared before that target can be treated as a fresh workspace again? [Coverage, Gap, Spec §FR-009, Spec §FR-010, Spec §FR-015]

## Dependencies & Assumptions

- [ ] CHK055 Are assumptions about same-filesystem worktree support and per-project database availability translated into explicit failure requirements when those assumptions are violated? [Assumption, Gap, Spec §FR-008, Spec §FR-011, Assumptions]
