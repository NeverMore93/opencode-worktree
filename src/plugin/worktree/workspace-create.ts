/**
 * Workspace creation: pre-check, reconcile planning, parallel execution,
 * persistence wiring, and top-level orchestration.
 *
 * This module implements:
 * - T011: Branch-collision pre-check (FR-009)
 * - T012: Per-repo reconcile planning (FR-007, FR-022)
 * - T013: Parallel worktree creation + sync + hooks (FR-007, FR-008)
 * - T014: Persistence with FR-023 mutation ordering
 * - T015: Top-level orchestrator (`orchestrateWorkspaceCreate`)
 * - T016: Fork failure handling (FR-015)
 *
 * Ordering per FR-023: pre-check → worktrees+sync+hooks → session fork →
 * member writes (only after fork succeeds).
 *
 * @module worktree/workspace-create
 */

import * as path from "node:path"
import { stat } from "node:fs/promises"
import type { OpencodeClient } from "../kdco-primitives/types"
import type { Logger } from "./config"
import { loadWorktreeConfig } from "./config"
import {
	type Result,
	Result as R,
	type WorktreeEntry,
	branchExists,
	createWorktree,
	git,
	worktreeListDetailed,
	worktreePrune,
} from "./git"
import {
	type WorkspaceMember,
	getOrInitDb,
	getWorkspaceAssociation,
	getWorkspaceMembers,
	upsertWorkspaceAssociation,
	upsertWorkspaceMember,
} from "./state"
import { copyFiles, runHooks, symlinkDirs } from "./sync"
import {
	type DetectedRepo,
	acquireWorkspaceLock,
	resolveWorkspaceTarget,
	validateWorkspaceName,
	checkWorkspaceNameAvailable,
} from "./workspace"
import {
	type SessionDisposition,
	resolveWorkspaceSession,
} from "./workspace-session"

// =============================================================================
// TYPES — Member Status / Outcomes
// =============================================================================

/** Per-repo disposition after workspace creation or reconciliation. */
export type MemberStatus = "created" | "reused" | "retried" | "failed"

/** Per-repo outcome included in the workspace create response (FR-019). */
export interface MemberOutcome {
	readonly name: string
	readonly worktreePath: string
	readonly branch: string
	readonly status: MemberStatus
	readonly error?: string
}

// =============================================================================
// TYPES — Planning
// =============================================================================

/** Planned action for a single repo within a workspace create/reconcile. */
export interface RepoWorktreePlan {
	/** The detected repository this plan targets. */
	readonly repo: DetectedRepo
	/** Branch to check out or create (computed or stored). */
	readonly branch: string
	/** Absolute worktree target path: `<workspacePath>/<repo.name>/` */
	readonly worktreePath: string
	/** What git worktree operation to perform. */
	readonly action: "create" | "reuse" | "retry"
	/** True when a worktree dir exists on disk but has no DB record. */
	readonly isOrphan: boolean
}

/** A collision found during the FR-009 pre-check phase. */
export interface CollisionError {
	readonly repoName: string
	readonly branch: string
	/** Path of the existing worktree that already has the branch checked out. */
	readonly conflictingPath: string
}

/**
 * A pre-check could not be completed for one repo (FR-009 case (b)).
 *
 * Distinct from `CollisionError`:
 * - `CollisionError` = pre-check ran successfully and found a confirmed
 *   branch collision → whole-command reject.
 * - `PreCheckFailure` = pre-check itself errored on this repo (e.g., `git
 *   worktree list` failed, lock held, transient I/O) → that repo MUST be
 *   marked `status="failed"` and excluded from subsequent steps; other
 *   repos continue.
 */
export interface PreCheckFailure {
	readonly repoName: string
	readonly reason: string
}

/** Aggregated output of the FR-009 branch-collision pre-check. */
export interface PreCheckOutcome {
	readonly collisions: CollisionError[]
	readonly preCheckFailures: PreCheckFailure[]
}

/** Full response from workspace create/reconcile (FR-019). */
export interface WorkspaceCreateResult {
	readonly workspacePath: string
	readonly sessionId: string
	readonly sessionDisposition: SessionDisposition
	readonly repos: MemberOutcome[]
	readonly warnings: string[]
}

// =============================================================================
// BRANCH NAME COMPUTATION — FR-005
// =============================================================================

/**
 * Compute the workspace branch name per FR-005 (2026-04-17).
 *
 * Format: `dev_{baseBranch}_{workspaceName}_{YYMMDD}`
 * - `baseBranch` is the local short branch name from `git rev-parse --abbrev-ref HEAD`,
 *   preserved as-is — `/` is NOT substituted (git supports `/` in ref names natively;
 *   substitution was an unauthorised iteration-2 rule and was removed in spec Part 3).
 * - Detached HEAD passes the SHA[:12] as `baseBranch` (see `resolveBaseBranch`).
 *
 * @param baseBranch - Current HEAD short branch name (with `/` intact), or SHA[:12]
 *                     if detached. Remote prefixes (`origin/...`) are stripped upstream.
 * @param workspaceName - The workspace name from `/dev <name>`
 * @param date - Date to use for YYMMDD suffix (defaults to now)
 * @returns Formatted branch name (e.g., `dev_feature/login_prd_1_260417`)
 */
export function computeBranchName(
	baseBranch: string,
	workspaceName: string,
	date?: Date,
): string {
	const d = date ?? new Date()
	const yy = String(d.getFullYear()).slice(-2)
	const mm = String(d.getMonth() + 1).padStart(2, "0")
	const dd = String(d.getDate()).padStart(2, "0")
	return `dev_${baseBranch}_${workspaceName}_${yy}${mm}${dd}`
}

/**
 * Resolve the current HEAD into a base branch name suitable for branch computation.
 *
 * If HEAD is on a named branch, returns the short branch name (`git rev-parse
 * --abbrev-ref HEAD`). Remote prefixes such as `origin/` are not produced by
 * `--abbrev-ref` for local branches; if the user explicitly checked out a
 * remote-tracking ref the result is "HEAD" (detached) and we fall through.
 *
 * If HEAD is detached, returns the abbreviated commit SHA — 12 hex chars per
 * FR-005 (extended from 8 in spec Part 3 to reduce birthday-paradox collision
 * risk in monorepos with millions of commits).
 *
 * @param repoPath - Absolute path to the repository root
 * @returns Result with the base branch string, or an error if git fails
 */
async function resolveBaseBranch(repoPath: string): Promise<Result<string, string>> {
	const headResult = await git(["rev-parse", "--abbrev-ref", "HEAD"], repoPath)
	if (!headResult.ok) {
		return headResult
	}

	// git rev-parse --abbrev-ref HEAD returns "HEAD" when detached
	if (headResult.value === "HEAD") {
		const shaResult = await git(["rev-parse", "--short=12", "HEAD"], repoPath)
		if (!shaResult.ok) {
			return shaResult
		}
		return R.ok(shaResult.value)
	}

	return R.ok(headResult.value)
}

// =============================================================================
// BRANCH COLLISION PRE-CHECK — FR-009 (T011)
// =============================================================================

/**
 * Pre-check phase per FR-009 (2026-04-17 dual-path semantics).
 *
 * For every plan that will run `git worktree add`, we ask the source repo
 * whether the target branch is already checked out at a live worktree path
 * outside our target workspace. The function returns BOTH categories of
 * outcome so the caller can apply the correct response per FR-009:
 *
 *   (a) `collisions` — confirmed branch collisions (target branch already
 *       checked out elsewhere). FR-009 mandates whole-command reject:
 *       caller MUST abort before any mutation and surface the conflicting
 *       repo/branch/external path.
 *
 *   (b) `preCheckFailures` — pre-check itself could not run for a specific
 *       repo (e.g., `git worktree list` errored, lock held, transient I/O).
 *       FR-009 mandates per-repo `status="failed"` and exclusion from
 *       subsequent steps for that repo only; other repos continue.
 *
 * `worktreeListDetailed` surfaces git errors via its `Result` return (not
 * throws), so those failures are captured into `preCheckFailures` and the
 * rest of the pre-check continues so all repos get evaluated.
 *
 * @param plans         Planned repo worktree actions (only "create" and
 *                      "retry" plans require pre-check; "reuse" already
 *                      has a healthy worktree at the expected path).
 * @param workspacePath Absolute path to the target workspace root. Used
 *                      to distinguish "external" collisions from worktrees
 *                      we already own inside the workspace.
 * @returns PreCheckOutcome with both `collisions` and `preCheckFailures`.
 *          A successful pre-check returns both arrays empty.
 */
export async function checkBranchCollisions(
	plans: RepoWorktreePlan[],
	workspacePath: string,
): Promise<PreCheckOutcome> {
	const collisions: CollisionError[] = []
	const preCheckFailures: PreCheckFailure[] = []

	// Normalize workspacePath for reliable prefix comparison
	const normalizedWorkspace = path.resolve(workspacePath)

	// Only check plans that will actually create or re-create worktrees.
	// "reuse" plans already have a healthy worktree at the expected path.
	const plansToCheck = plans.filter((p) => p.action === "create" || p.action === "retry")

	// Collect all worktree entries per unique repo root (dedup in case
	// multiple plans reference the same repo root — shouldn't happen but
	// defensive).
	const worktreeCache = new Map<string, WorktreeEntry[]>()
	// Repo roots whose pre-check has already failed; skip subsequent plans
	// referencing the same repo to avoid duplicate failure entries.
	const failedRepoRoots = new Set<string>()

	for (const plan of plansToCheck) {
		const repoRoot = plan.repo.path

		// Skip plans whose repo has already failed pre-check in an earlier
		// iteration (defensive; in practice plansToCheck contains one entry
		// per repo).
		if (failedRepoRoots.has(repoRoot)) continue

		// Fetch detailed worktree list (cached per repo root). On failure,
		// record it as a per-repo PreCheckFailure rather than silently
		// treating the repo as collision-free — FR-009 case (b) requires
		// this repo to be marked failed without aborting the whole
		// pre-check. `worktreeListDetailed` returns Result, not throws, so
		// the error surfaces via result.ok rather than try/catch.
		if (!worktreeCache.has(repoRoot)) {
			const result = await worktreeListDetailed(repoRoot)
			if (!result.ok) {
				preCheckFailures.push({
					repoName: plan.repo.name,
					reason: `pre-check failed: ${result.error}`,
				})
				failedRepoRoots.add(repoRoot)
				continue
			}
			worktreeCache.set(repoRoot, result.value)
		}
		const entries = worktreeCache.get(repoRoot)!

		for (const entry of entries) {
			// Skip entries that don't match the target branch
			if (entry.branch !== plan.branch) continue

			// Skip entries that are INSIDE the target workspace (those are ours)
			const normalizedEntry = path.resolve(entry.path)
			if (normalizedEntry.startsWith(normalizedWorkspace + path.sep) || normalizedEntry === normalizedWorkspace) {
				continue
			}

			collisions.push({
				repoName: plan.repo.name,
				branch: plan.branch,
				conflictingPath: entry.path,
			})
		}
	}

	return { collisions, preCheckFailures }
}

// =============================================================================
// WORKTREE HEALTH CHECK — FR-022
// =============================================================================

/**
 * Check if a worktree is healthy per FR-022:
 * (a) worktree directory exists on disk
 * (b) directory contains a `.git` file or directory
 * (c) repo's `git worktree list` output includes the worktree path
 *
 * @param worktreePath - Absolute path to the worktree directory
 * @param repoPath - Absolute path to the source repository root
 * @returns true if all three conditions are met
 */
async function isWorktreeHealthy(
	worktreePath: string,
	repoPath: string,
): Promise<boolean> {
	// (a) Does the worktree directory exist?
	try {
		const dirStat = await stat(worktreePath)
		if (!dirStat.isDirectory()) return false
	} catch {
		return false
	}

	// (b) Does the directory contain a .git file or directory?
	try {
		await stat(path.join(worktreePath, ".git"))
	} catch {
		return false
	}

	// (c) Is the path listed in `git worktree list`?
	// If git fails (e.g. repo corrupted or binary missing), treat the
	// worktree as unhealthy — the reconcile path will then retry via
	// `git worktree add` which will surface the underlying error.
	const result = await worktreeListDetailed(repoPath)
	if (!result.ok) return false
	const normalizedTarget = path.resolve(worktreePath)
	return result.value.some((entry) => path.resolve(entry.path) === normalizedTarget)
}

// =============================================================================
// RECONCILE PLANNING — FR-007, FR-022 (T012)
// =============================================================================

/**
 * For each detected repo, classify what action to take:
 * - `"reuse"` if existing member record + healthy worktree (FR-022)
 * - `"retry"` if existing but unhealthy, previously failed, or orphan
 * - `"create"` if no existing member record and no orphan directory
 *
 * Branch names are computed per FR-005 (2026-04-17): `dev_{base_branch}_{name}_{YYMMDD}`.
 * `base_branch` is the local short HEAD name preserved as-is — slashes are NOT
 * substituted (the iteration-2 `/`→`-` rule was removed in spec Part 3). When
 * HEAD is detached, `base_branch` is the first 12 hex characters of the commit
 * SHA. Stored branch names from existing members are reused verbatim — the date
 * does not re-roll on reconciliation runs.
 *
 * Orphan detection: if a worktree directory exists at the expected path but
 * has no corresponding DB record, it is classified as an orphan needing
 * `"retry"` with a freshly computed branch name.
 *
 * @param repos - Detected git repositories from cwd scan
 * @param workspacePath - Absolute path to the target workspace root
 * @param workspaceName - The `/dev <name>` argument
 * @param existingMembers - Previously persisted members keyed by projectId
 * @returns Ordered array of plans, one per repo
 */
/**
 * Output of `planRepoWorktrees`: the plans to execute plus per-repo planning
 * failures (analogous to {@link PreCheckOutcome.preCheckFailures}).
 *
 * Planning failures are repos we refuse to mutate because we cannot even
 * compute a safe plan — typically `git rev-parse HEAD` failed, so we don't
 * know what base branch to derive the workspace branch from. Creating a
 * placeholder like `dev_unknown_*` would silently produce the wrong branch,
 * so the orchestrator treats these as `status="failed"` and excludes them
 * from execution, the same way it handles confirmed pre-check failures.
 */
export interface PlanningOutcome {
	readonly plans: RepoWorktreePlan[]
	readonly planningFailures: PreCheckFailure[]
}

export async function planRepoWorktrees(
	repos: DetectedRepo[],
	workspacePath: string,
	workspaceName: string,
	existingMembers: Map<string, WorkspaceMember>,
): Promise<PlanningOutcome> {
	const plans: RepoWorktreePlan[] = []
	const planningFailures: PreCheckFailure[] = []

	for (const repo of repos) {
		const worktreePath = path.join(workspacePath, repo.name)
		const existing = existingMembers.get(repo.projectId)

		if (existing) {
			// Existing member record — check health to decide reuse vs retry
			const healthy = await isWorktreeHealthy(existing.worktreePath, repo.path)

			if (healthy && existing.status !== "failed") {
				// FR-022: all health checks pass and last status was not failed → reuse
				plans.push({
					repo,
					branch: existing.branch,
					worktreePath: existing.worktreePath,
					action: "reuse",
					isOrphan: false,
				})
			} else {
				// Unhealthy or previously failed → retry with stored branch name
				plans.push({
					repo,
					branch: existing.branch,
					worktreePath,
					action: "retry",
					isOrphan: false,
				})
			}
		} else {
			// No existing member record — check if the target directory exists.
			let dirExists = false
			try {
				const dirStat = await stat(worktreePath)
				if (dirStat.isDirectory()) {
					dirExists = true
				}
			} catch {
				// Directory doesn't exist — clean create path below.
			}

			if (dirExists) {
				// The path already exists on disk but our DB has no record of it.
				// Previously we classified this as an "orphan" and let the execution
				// phase rm -rf the directory. That could silently destroy user
				// files or a retained worktree with uncommitted changes whenever
				// the directory happens not to be one we created.
				//
				// Instead, only adopt paths that are provably git worktrees we
				// can reuse: they must have a `.git` entry AND appear in
				// `git worktree list` for this repo. If either check fails we
				// refuse to touch the directory and emit a planning failure so
				// the user can resolve the conflict manually.
				const entriesResult = await worktreeListDetailed(repo.path)
				const entries = entriesResult.ok ? entriesResult.value : []
				const normalizedWorktreePath = path.resolve(worktreePath)
				const existingEntry = entries.find(
					(entry) => path.resolve(entry.path) === normalizedWorktreePath,
				)
				const hasGitEntry = await stat(path.join(worktreePath, ".git"))
					.then(() => true)
					.catch(() => false)

				if (hasGitEntry && existingEntry?.branch) {
					plans.push({
						repo,
						branch: existingEntry.branch,
						worktreePath,
						action: "reuse",
						isOrphan: false,
					})
					continue
				}

				planningFailures.push({
					repoName: repo.name,
					reason: `target path exists but is not an adoptable git worktree: ${worktreePath}`,
				})
				continue
			}

			// Compute branch name for new repos (fresh date)
			const baseBranchResult = await resolveBaseBranch(repo.path)
			if (!baseBranchResult.ok) {
				// Cannot resolve HEAD — don't try to plan a worktree we can't name
				// correctly. Record as a planning failure so the orchestrator
				// surfaces it as `status="failed"` for this repo and skips it
				// from mutation. Fabricating `dev_unknown_*` would create a
				// silently-wrong branch on the source repo.
				planningFailures.push({
					repoName: repo.name,
					reason: `failed to resolve HEAD for base branch: ${baseBranchResult.error}`,
				})
				continue
			}

			const branch = computeBranchName(baseBranchResult.value, workspaceName)

			plans.push({
				repo,
				branch,
				worktreePath,
				action: "create",
				isOrphan: false,
			})
		}
	}

	return { plans, planningFailures }
}

// =============================================================================
// EXECUTION — Parallel worktree creation + sync + hooks (T013)
// =============================================================================

/**
 * Execute worktree creation for all planned repos in parallel.
 *
 * Plans with action `"reuse"` are immediately returned as `MemberOutcome`
 * with `status: "reused"`. Plans with `"create"` or `"retry"` run in
 * parallel via `Promise.allSettled`.
 *
 * Per-repo pipeline (sequential within each repo):
 * 1. If orphan: remove the orphan directory first (FR-007)
 * 2. `git worktree add` — if stale metadata error, `worktreePrune` + retry once (FR-008)
 * 3. Load per-repo config: `loadWorktreeConfig`
 * 4. Run sync: `copyFiles`, `symlinkDirs`
 * 5. Run hooks: `runHooks` with configurable timeout (default 30 min)
 *
 * Any error in the pipeline yields `status: "failed"` with an error message.
 *
 * @param plans - Planned repo worktree actions from `planRepoWorktrees`
 * @param workspacePath - Absolute path to the workspace root
 * @param client - OpenCode SDK client for logging
 * @param log - Structured logger
 * @returns Array of MemberOutcome, one per plan
 */
export async function executeWorktreeCreation(
	plans: RepoWorktreePlan[],
	workspacePath: string,
	client: OpencodeClient,
	log: Logger,
): Promise<MemberOutcome[]> {
	// Separate reuse plans from plans that need actual work
	const reuseOutcomes: MemberOutcome[] = []
	const actionPlans: RepoWorktreePlan[] = []

	for (const plan of plans) {
		if (plan.action === "reuse") {
			reuseOutcomes.push({
				name: plan.repo.name,
				worktreePath: plan.worktreePath,
				branch: plan.branch,
				status: "reused",
			})
		} else {
			actionPlans.push(plan)
		}
	}

	// Execute create/retry plans in parallel
	const settled = await Promise.allSettled(
		actionPlans.map((plan) => executeSingleRepo(plan, log)),
	)

	// Collect results
	const actionOutcomes: MemberOutcome[] = settled.map((result, idx) => {
		const plan = actionPlans[idx]
		if (result.status === "fulfilled") {
			return result.value
		}
		// Promise rejection (unexpected) — treat as failed
		const error = result.reason instanceof Error
			? result.reason.message
			: String(result.reason)
		return {
			name: plan.repo.name,
			worktreePath: plan.worktreePath,
			branch: plan.branch,
			status: "failed" as const,
			error,
		}
	})

	// Return in original plan order: reuse first, then action plans
	// (caller may want stable ordering; we preserve plan array order)
	return [...reuseOutcomes, ...actionOutcomes]
}

/**
 * Execute the worktree pipeline for a single repo.
 *
 * Sequential within one repo:
 * 1. Remove orphan directory if applicable
 * 2. `git worktree add` with prune-and-retry on stale metadata
 * 3. Load config, run sync, run hooks
 *
 * @returns MemberOutcome with appropriate status
 */
async function executeSingleRepo(
	plan: RepoWorktreePlan,
	log: Logger,
): Promise<MemberOutcome> {
	const { repo, branch, worktreePath, action } = plan
	const baseOutcome = { name: repo.name, worktreePath, branch }

	try {
		// Step 1: git worktree add (with prune+retry on stale metadata — FR-008).
		// Note: the planning phase now refuses to destructively recover unknown
		// directories at `worktreePath` — if a non-adoptable directory exists it
		// surfaces as a planning failure before we ever reach execution. So this
		// function never needs to rm -rf arbitrary paths.
		const needsNewBranch = !(await branchExists(repo.path, branch))
		let wtResult = await createWorktree(repo.path, branch, worktreePath, needsNewBranch)

		if (!wtResult.ok) {
			// Check if this might be a stale metadata issue — prune and retry once
			const errorLower = wtResult.error.toLowerCase()
			const isStaleMetadata =
				errorLower.includes("already locked") ||
				errorLower.includes("already checked out") ||
				errorLower.includes("is a missing but locked worktree")

			if (isStaleMetadata) {
				log.info(`[workspace] Pruning stale worktree metadata for ${repo.name}`)
				await worktreePrune(repo.path)
				// Retry once after prune
				wtResult = await createWorktree(repo.path, branch, worktreePath, needsNewBranch)
			}

			if (!wtResult.ok) {
				return { ...baseOutcome, status: "failed", error: `git worktree add failed: ${wtResult.error}` }
			}
		}

		// Step 3: Load per-repo config
		const config = await loadWorktreeConfig(repo.path, log)
		const timeoutMs = config.hooks.timeout > 0 ? config.hooks.timeout : undefined

		// Step 4: Run sync — copyFiles + symlinkDirs
		if (config.sync.copyFiles.length > 0) {
			await copyFiles(repo.path, worktreePath, config.sync.copyFiles, log)
		}
		if (config.sync.symlinkDirs.length > 0) {
			await symlinkDirs(repo.path, worktreePath, config.sync.symlinkDirs, log)
		}

		// Step 5: Run postCreate hooks with timeout (FR-011)
		if (config.hooks.postCreate.length > 0) {
			const hookResult = await runHooks(config.hooks.postCreate, worktreePath, log, timeoutMs)
			if (!hookResult.ok) {
				return { ...baseOutcome, status: "failed", error: `postCreate hook failed: ${hookResult.error}` }
			}
		}

		// Success — determine status based on action
		const status: MemberStatus = action === "create" ? "created" : "retried"
		return { ...baseOutcome, status }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { ...baseOutcome, status: "failed", error: message }
	}
}

// =============================================================================
// PERSISTENCE — FR-023 mutation ordering (T014)
// =============================================================================

/**
 * Persist workspace state to per-project databases.
 *
 * Per FR-023, this MUST only be called AFTER session fork succeeds.
 * The orchestrator ensures this ordering.
 *
 * For each repo with a matching outcome:
 * - Opens the repo's per-project DB via `getOrInitDb`
 * - Upserts `workspace_associations` with session info
 * - Upserts `workspace_members` with the outcome
 *
 * @param workspaceName - The validated workspace name
 * @param workspacePath - Absolute path to the workspace root
 * @param sourceCwd - The original session cwd
 * @param sessionId - The resolved workspace session ID
 * @param sessionDisposition - Whether the session was forked or reused
 * @param outcomes - Per-repo outcomes from executeWorktreeCreation
 * @param repos - The detected repos (for DB initialization)
 * @param client - OpenCode SDK client
 */
export async function persistWorkspaceState(
	workspaceName: string,
	workspacePath: string,
	sourceCwd: string,
	sessionId: string,
	sessionDisposition: SessionDisposition,
	outcomes: MemberOutcome[],
	repos: DetectedRepo[],
	client: OpencodeClient,
): Promise<void> {
	// Build a lookup from repoName → DetectedRepo for projectId + path
	const repoByName = new Map(repos.map((r) => [r.name, r]))

	for (const outcome of outcomes) {
		const repo = repoByName.get(outcome.name)
		if (!repo) continue // Defensive: skip if no matching repo

		const db = await getOrInitDb(repo.projectId, repo.path, client)

		// Wrap the two upserts in a single transaction so we never leave the
		// DB with a session binding that has no member row. A partial commit
		// would let the next reconcile misclassify the absent member as an
		// orphan and potentially trigger destructive recovery.
		// `db.transaction()` returns a callable that runs the body inside
		// BEGIN/COMMIT and automatically ROLLBACKs if the body throws.
		const persistRepo = db.transaction(() => {
			upsertWorkspaceAssociation(db, {
				name: workspaceName,
				workspacePath,
				sessionId,
				sessionDisposition,
				sourceCwd,
			})

			upsertWorkspaceMember(db, {
				workspaceName,
				workspacePath,
				repoName: outcome.name,
				projectId: repo.projectId,
				branch: outcome.branch,
				worktreePath: outcome.worktreePath,
				status: outcome.status,
				error: outcome.error ?? null,
			})
		})
		persistRepo()
	}
}

// =============================================================================
// ORCHESTRATOR — Top-level entry point (T015 + T016)
// =============================================================================

/**
 * Orchestrate a complete workspace create/reconcile operation.
 *
 * This is the top-level entry point called by the `worktree_workspace_create`
 * AI tool. It implements the full Integration Flow from plan.md:
 *
 * 1. Validate workspace name (FR-002)
 * 2. Resolve workspace target (FR-003, FR-004, FR-016)
 * 3. Acquire workspace lock (FR-017)
 * 4. Git fetch per repo (parallel, non-fatal)
 * 5. Load existing members from per-project DBs
 * 6. Plan repo worktrees (FR-005, FR-007, FR-022)
 * 7. Branch collision pre-check (FR-009)
 * 8. Execute worktree creation (FR-007, FR-008, FR-011, FR-012)
 * 9. Resolve workspace session (FR-013, FR-014)
 * 10. Persist state (FR-023 — only if session fork succeeded)
 * 11. Return WorkspaceCreateResult (FR-019)
 *
 * FR-015 (T016): If session fork fails, worktrees are retained on disk but
 * no member records are written. The error includes the workspace path so
 * the caller knows where the worktrees are. Next `/dev` run reconciles.
 *
 * @param cwd - The current working directory (contains repos)
 * @param name - Raw workspace name from user input
 * @param parentSessionId - Current caller's session ID (for fork)
 * @param client - OpenCode SDK client
 * @param log - Structured logger
 * @returns Result with WorkspaceCreateResult on success, or error string
 */
export async function orchestrateWorkspaceCreate(
	cwd: string,
	name: string,
	parentSessionId: string,
	client: OpencodeClient,
	log: Logger,
): Promise<Result<WorkspaceCreateResult, string>> {
	// ── Step 1: Validate workspace name ──────────────────────────────────
	const nameResult = validateWorkspaceName(name)
	if (!nameResult.ok) {
		return R.err(nameResult.error)
	}
	const validName = nameResult.value

	// ── Step 1b: Namespace conflict check (T008 / H8) ────────────────────
	// FR-024 auto-creates `.opencode/commands/dev.md`; reject names that
	// would collide with built-in `init`/`review` or any other existing
	// `.opencode/commands/<name>.md` file before mutating any worktree.
	const availResult = await checkWorkspaceNameAvailable(validName, cwd)
	if (!availResult.ok) {
		return R.err(availResult.error)
	}

	// ── Step 2: Resolve workspace target ─────────────────────────────────
	const targetResult = await resolveWorkspaceTarget(cwd, validName, client)
	if (!targetResult.ok) {
		return R.err(targetResult.error)
	}
	const target = targetResult.value
	const warnings = [...target.warnings]

	if (target.repos.length === 0) {
		return R.err("No git repos found in the current working directory")
	}

	// ── Step 3: Acquire workspace lock ───────────────────────────────────
	const release = await acquireWorkspaceLock(target.workspacePath)

	try {
		// ── Step 4: Git fetch per repo (parallel, non-fatal) ─────────────
		const fetchResults = await Promise.allSettled(
			target.repos.map(async (repo) => {
				const result = await git(["fetch", "--all", "--quiet"], repo.path)
				if (!result.ok) {
					return { repo: repo.name, error: result.error }
				}
				return { repo: repo.name, error: null }
			}),
		)
		for (const result of fetchResults) {
			if (result.status === "fulfilled" && result.value.error) {
				warnings.push(`git fetch failed for ${result.value.repo}: ${result.value.error}`)
			} else if (result.status === "rejected") {
				const error = result.reason instanceof Error ? result.reason.message : String(result.reason)
				warnings.push(`git fetch failed: ${error}`)
			}
		}

		// ── Step 5: Load existing members from per-project DBs ──────────
		// Fail-fast on DB init failure. If we silently skipped a repo whose
		// state DB couldn't be opened, its existing members would be missing
		// from `existingMembers`; `planRepoWorktrees` would then classify
		// the still-present worktree directory as an orphan, and
		// `executeSingleRepo` would `rm -rf` the worktree — destroying the
		// previous reconcile including any uncommitted work. Fail now so
		// the caller can retry; no filesystem mutation has happened yet.
		const existingMembers = new Map<string, WorkspaceMember>()
		for (const repo of target.repos) {
			try {
				const db = await getOrInitDb(repo.projectId, repo.path, client)
				const members = getWorkspaceMembers(db, validName, target.workspacePath)
				for (const member of members) {
					existingMembers.set(member.projectId, member)
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				return R.err(
					`Failed to open state DB for ${repo.name} (projectId=${repo.projectId}): ${message}. ` +
						`No mutations have been performed — re-run to retry.`,
				)
			}
		}

		// ── Step 6: Plan repo worktrees ─────────────────────────────────
		const planning = await planRepoWorktrees(
			target.repos,
			target.workspacePath,
			validName,
			existingMembers,
		)
		const plans = planning.plans

		// Planning failures (e.g. HEAD unresolvable) surface as per-repo
		// `status="failed"` outcomes and are excluded from subsequent mutation.
		const planningFailureOutcomes: MemberOutcome[] = planning.planningFailures.map((failure) => ({
			name: failure.repoName,
			worktreePath: path.join(target.workspacePath, failure.repoName),
			branch: "",
			status: "failed" as const,
			error: failure.reason,
		}))

		// ── Step 7: Branch collision pre-check (FR-009 dual-path) ───────
		const preCheck = await checkBranchCollisions(plans, target.workspacePath)

		// FR-009 case (a) — confirmed branch collision = whole-command reject
		if (preCheck.collisions.length > 0) {
			const details = preCheck.collisions
				.map((c) => `  ${c.repoName}: branch "${c.branch}" already at ${c.conflictingPath}`)
				.join("\n")
			return R.err(`Branch collision detected — entire command rejected:\n${details}`)
		}

		// FR-009 case (b) — pre-check failed for individual repos = per-repo
		// `status="failed"`, those repos are excluded from execution but the
		// rest continue. Synthesize MemberOutcomes for the failed repos so
		// they appear in the response alongside execution results.
		const preCheckFailedNames = new Set(preCheck.preCheckFailures.map((f) => f.repoName))
		const preCheckFailureOutcomes: MemberOutcome[] = preCheck.preCheckFailures.map((failure) => {
			const failedPlan = plans.find((p) => p.repo.name === failure.repoName)
			return {
				name: failure.repoName,
				worktreePath: failedPlan?.worktreePath ?? path.join(target.workspacePath, failure.repoName),
				branch: failedPlan?.branch ?? "",
				status: "failed" as const,
				error: failure.reason,
			}
		})

		// ── Step 8: Execute worktree creation (skip pre-check failures) ─
		const plansToExecute = plans.filter((p) => !preCheckFailedNames.has(p.repo.name))
		const executionOutcomes = await executeWorktreeCreation(
			plansToExecute,
			target.workspacePath,
			client,
			log,
		)

		// Planning failures use `branch: ""` because we could not compute a
		// safe branch name. That violates `workspaceMemberSchema`'s non-empty
		// branch constraint, so they must never reach persistence — we keep
		// them only in the response/outcome list.
		// Pre-check failures inherit their branch from the plan, which is
		// always a valid computed name, so they ARE safe to persist (each
		// failed repo gets a `status="failed"` member record so the next
		// reconcile run can pick them up).
		const persistableOutcomes = [...executionOutcomes, ...preCheckFailureOutcomes]
		const outcomes = [...persistableOutcomes, ...planningFailureOutcomes]

		// ── Step 9: Resolve workspace session (FR-013, FR-014) ──────────
		// Look up any existing stored session ID for this workspace. Must scan
		// every member repo's DB: if we only inspected the first repo, a
		// newly-added repo (no association yet) at index 0 would make us fork
		// a second workspace-level session even though a sibling repo's DB
		// already holds the valid binding — violating FR-013's "exactly one
		// workspace-level session" invariant.
		let storedSessionId: string | undefined
		for (const repo of target.repos) {
			try {
				const db = await getOrInitDb(repo.projectId, repo.path, client)
				const assoc = getWorkspaceAssociation(db, validName, target.workspacePath)
				if (assoc?.sessionId) {
					storedSessionId = assoc.sessionId
					break
				}
			} catch {
				// Non-fatal — skip this repo and keep scanning the others.
			}
		}

		// Use the first repo's projectId for session context
		const projectId = target.repos[0].projectId
		const sessionResult = await resolveWorkspaceSession(
			client,
			parentSessionId,
			projectId,
			storedSessionId,
		)

		// ── T016 / FR-015: Fork failure handling ────────────────────────
		// If session fork fails, retain worktrees on disk but do NOT persist
		// member records. Return error with retained worktree info.
		if (!sessionResult.ok) {
			const retainedPaths = outcomes
				.filter((o) => o.status !== "failed")
				.map((o) => `  ${o.name}: ${o.worktreePath}`)
				.join("\n")

			return R.err(
				`Session fork failed: ${sessionResult.error}\n` +
				`Worktrees were created but no state was persisted.\n` +
				`Retained worktrees:\n${retainedPaths}\n` +
				`Re-run /dev ${name} to reconcile.`,
			)
		}

		const session = sessionResult.value

		// ── Step 10: Persist state (FR-023 — only after fork succeeded) ──
		// Only persist `persistableOutcomes`. `planningFailureOutcomes`
		// carry `branch: ""` which would fail `workspaceMemberSchema`
		// validation (see Step 8 comment).
		await persistWorkspaceState(
			validName,
			target.workspacePath,
			cwd,
			session.sessionId,
			session.disposition,
			persistableOutcomes,
			target.repos,
			client,
		)

		// ── Step 11: Return result ──────────────────────────────────────
		return R.ok({
			workspacePath: target.workspacePath,
			sessionId: session.sessionId,
			sessionDisposition: session.disposition,
			repos: outcomes,
			warnings,
		})
	} finally {
		// ── Always release the workspace lock ────────────────────────────
		release()
	}
}
