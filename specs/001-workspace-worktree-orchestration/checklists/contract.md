# API & Response Contract Quality Checklist

**Purpose**: Validate requirement quality for tool input/response schema, status enumerations, and the slash↔AI-tool surface (including deferral). FR-001, FR-002, FR-019, FR-020, FR-021.
**Created**: 2026-04-17 (iteration-2)
**Feature**: [spec.md](../spec.md)
**Sister checklists**: `requirements.md` (overview), `state.md` (state machine), `error.md` (failure modes)

## Tool Surface

- [ ] CHK001 Is the AI tool `worktree_workspace_create` input parameter schema fully specified beyond `name` (any optional flags, env-derived defaults, future-extension reserved fields)? [Completeness, Spec §FR-001, FR-002]
- [x] CHK002 Is the slash command registration mechanism specified to the level needed for plan: when SDK adds support, what surface MUST it map to (single tool? new tool?), and what fallback exists today? [Completeness, Gap, Spec §FR-001, Assumptions] — **Resolved 2026-04-17**: FR-024 specifies markdown-based registration via `.opencode/commands/dev.md` (auto-created by plugin).
- [x] CHK003 With slash deferred, does the spec require an alternative "explicit user trigger" affordance in the AI tool surface to honor the original "switching cwd is a deliberate act" intent (e.g., requiring a user-level confirmation parameter)? [Gap, Spec §FR-001, Assumptions] — **Resolved 2026-04-17**: Slash command IS the explicit trigger; deferral removed.
- [x] CHK004 Does the spec define behavior when a user attempts `/dev <name>` in an environment where slash is unsupported: silent ignore, error message, fallback prompt to use AI tool? [Coverage, Gap, Spec §FR-001, Assumptions] — **Resolved 2026-04-17**: Slash is universally supported via FR-024 markdown; "unsupported" case no longer applies.

## Response Schema

- [ ] CHK005 Is the response `warnings` array content contract specified — what triggers a warning, the format of each entry, and ordering guarantees? [Completeness, Spec §FR-016, FR-019]
- [ ] CHK006 Is the per-repo `error?: string` field's schema scoped: human-readable only, or should an additional machine-readable error code be required for caller routing? [Completeness, Spec §FR-019]
- [ ] CHK007 Are the `status` values (`created`, `reused`, `retried`, `failed`) and `sessionDisposition` values (`forked`, `reused`) defined with exact triggering conditions, mutual exclusivity, and stability across versions? [Clarity, Spec §FR-019]
- [ ] CHK008 Is the response shape required to include `workspacePath` as an absolute, normalized path (so callers do not need to resolve `..`)? [Clarity, Gap, Spec §FR-019]

## Branch Naming Contract

- [x] CHK009 Does FR-005's `/` → `-` substitution rule account for collision: if source repos hold both `release/1.2.3` and `release-1.2.3` branches, both map to the same worktree branch name. Is this surfaced as a warning, error, or silently overwritten? [Consistency, Gap, Spec §FR-005, FR-009] — **Resolved 2026-04-17**: FR-005 substitution rule **deleted entirely**. `base_branch` preserves `/` as-is. Collision risk eliminated at source.
- [ ] CHK010 Is FR-005's SHA[:8] (8 hex chars) sufficient for detached-HEAD branch naming in monorepos with millions of commits — does the spec acknowledge birthday-paradox collision risk or specify a fallback? [Coverage, Gap, Spec §FR-005]
- [ ] CHK011 Does the spec bound the maximum total branch name length so `dev_{base}_{name}_{YYMMDD}` cannot exceed git's ref limits (e.g., 250 chars) when `name` is 64 + `base` is long? [Coverage, Gap, Spec §FR-002, FR-005]

## Performance Contract

- [ ] CHK012 SC-001 ("5+ repos in under 30 seconds") and SC-002 ("15-second reconciliation") — given slash deferral, is the timer scope defined as AI-tool round-trip, or end-to-end including chat latency? Is the test environment constrained (network, disk class)? [Measurability, Spec §SC-001, SC-002, Assumptions]
- [ ] CHK013 Does SC-005 ("never silently corrupts") have an objectively verifiable assertion via the response contract alone (no implementation inspection required)? [Measurability, Spec §SC-005, FR-019]

## Notes

- 13 items. Slash deferral creates 4 contract-level gaps (CHK002–CHK004 + CHK012). These should be resolved or explicitly accepted before plan.
- CHK009 (`/` → `-` collision) is a real silent-corruption risk — pre-check (FR-009) does not catch it because the substitution happens before pre-check.
