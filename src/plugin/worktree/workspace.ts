/**
 * Workspace validation, repo detection, path resolution, and locking.
 *
 * Provides the foundational layer for workspace-level worktree orchestration:
 * - Validate `/dev <name>` arguments (FR-002)
 * - Auto-detect git repositories in the session cwd (FR-003)
 * - Resolve target workspace paths with nesting rejection (FR-004)
 * - Report unrelated root-level content as warnings (FR-016)
 * - Serialize concurrent workspace operations via per-path mutex (FR-017)
 *
 * @module worktree/workspace
 */

import { readdir, stat } from "node:fs/promises"
import * as path from "node:path"
import { getProjectId } from "../kdco-primitives/get-project-id"
import { logWarn } from "../kdco-primitives/log-warn"
import { Mutex } from "../kdco-primitives/mutex"
import type { OpencodeClient } from "../kdco-primitives/types"
import { type Result, Result as ResultNs } from "./git"

// =============================================================================
// TYPES
// =============================================================================

/**
 * Branded workspace name validated against FR-002 regex.
 *
 * Only values that have passed through `validateWorkspaceName` should carry
 * this type. The brand prevents accidental use of unvalidated strings.
 */
declare const WorkspaceNameBrand: unique symbol
type WorkspaceName = string & { readonly [WorkspaceNameBrand]: typeof WorkspaceNameBrand }

/** A git repo detected via auto-scan of direct subdirectories. */
interface DetectedRepo {
	/** Directory name (basename of the repo root) */
	name: string
	/** Absolute path to the repo root */
	path: string
	/** Stable project ID from getProjectId() */
	projectId: string
}

/** Resolved workspace target with all information needed for orchestration. */
interface WorkspaceTarget {
	/** Validated workspace name */
	name: WorkspaceName
	/** The original session cwd */
	sourceCwd: string
	/** Resolved target path: <cwd>/../worktrees/<name>/ */
	workspacePath: string
	/** Auto-detected git repositories */
	repos: DetectedRepo[]
}

// =============================================================================
// WORKSPACE NAME VALIDATION (FR-002)
// =============================================================================

/**
 * Regex for valid workspace names.
 *
 * Requirements (FR-002):
 * - 1–64 characters
 * - ASCII alphanumeric plus `_` and `-`
 * - Must start with an alphanumeric character
 *
 * This implicitly excludes `/`, shell metacharacters, empty strings,
 * names starting with `-`, and platform-reserved names (., .., CON, NUL, etc.)
 */
const WORKSPACE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

/**
 * Validate a workspace name against the FR-002 pattern.
 *
 * @param name - Raw name string from user input
 * @returns Ok with branded WorkspaceName, or Err with descriptive message
 *
 * @example
 * ```ts
 * const result = validateWorkspaceName("prd_1")
 * if (result.ok) {
 *   // result.value is WorkspaceName
 * }
 * ```
 */
function validateWorkspaceName(name: string): Result<WorkspaceName, string> {
	if (!WORKSPACE_NAME_RE.test(name)) {
		return ResultNs.err(
			`Invalid workspace name: "${name}". ` +
				"Must be 1–64 characters, start with an alphanumeric character, " +
				"and contain only ASCII alphanumeric, underscore, or hyphen.",
		)
	}
	return ResultNs.ok(name as WorkspaceName)
}

/**
 * OpenCode built-in slash commands that workspace names MUST NOT shadow
 * (T008 / H8 / FR-024 namespace hygiene). Sourced from OpenCode
 * `packages/opencode/src/command/index.ts:60-63`:
 *
 *   export const Default = { INIT: "init", REVIEW: "review" } as const
 *
 * Update if OpenCode adds more built-in prompt commands.
 */
const RESERVED_COMMAND_NAMES = new Set(["init", "review"])

/**
 * Verify a workspace name does not collide with built-in OpenCode commands or
 * an existing custom command file.
 *
 * Why this matters (T008 / H8): OpenCode discovers `.opencode/commands/<x>.md`
 * as user slash commands. If the workspace name visually matches an existing
 * command (built-in or custom), users get confused — typing `/init` becomes
 * ambiguous between the OpenCode init flow and "open the workspace named init".
 * This check surfaces the conflict before any worktree is mutated and before
 * FR-024 auto-create runs.
 *
 * The literal name `"dev"` is intentionally NOT flagged: that file is
 * auto-created by FR-024 (`ensureDevCommand`) and exists by design. A
 * workspace named `dev` lives at `worktrees/dev/`, separate from the
 * `dev.md` slash command file.
 *
 * Failure modes:
 * - Name is in {init, review} → reject (built-in collision).
 * - `<directory>/.opencode/commands/<name>.md` exists and name !== "dev" →
 *   reject (custom command collision).
 * - Filesystem stat itself fails (permissions, transient I/O) → allow
 *   (degraded — actual conflict will surface elsewhere). Logged via thrown
 *   exception path which we swallow here so we never block on a stale FS.
 *
 * @param name      Already-validated workspace name (must have passed
 *                  `validateWorkspaceName` first).
 * @param directory Plugin's project directory (`ctx.directory`). The
 *                  `.opencode/commands/` lookup is relative to this so we
 *                  match the same scope OpenCode will scan.
 */
async function checkWorkspaceNameAvailable(
	name: string,
	directory: string,
): Promise<Result<void, string>> {
	if (RESERVED_COMMAND_NAMES.has(name)) {
		return ResultNs.err(
			`Workspace name "${name}" conflicts with an OpenCode built-in slash command. ` +
				`Reserved names: ${[...RESERVED_COMMAND_NAMES].sort().join(", ")}.`,
		)
	}

	if (name !== "dev") {
		const conflictPath = path.join(directory, ".opencode", "commands", `${name}.md`)
		try {
			if (await Bun.file(conflictPath).exists()) {
				return ResultNs.err(
					`Workspace name "${name}" conflicts with an existing slash command at ${conflictPath}. ` +
						`Either rename the workspace or remove the conflicting command file.`,
				)
			}
		} catch {
			// Treat FS check failure as non-fatal: if we cannot prove a conflict
			// exists, allow the workspace and let later steps surface the real
			// problem if any.
		}
	}

	return ResultNs.ok(undefined)
}

// =============================================================================
// REPO DETECTION (FR-003)
// =============================================================================

/**
 * Scan direct subdirectories of cwd for git repositories.
 *
 * A directory qualifies as a repo if it contains a `.git` entry (file or
 * directory). This covers both normal repositories and worktree checkouts
 * (where `.git` is a file pointing to the main repo's `.git/worktrees/`).
 *
 * Exclusions:
 * - Hidden directories (starting with `.`)
 * - Bare repositories (no `.git` entry at the directory level)
 * - Submodules are not recursed into (only direct children scanned)
 *
 * @param cwd - Absolute path to the session working directory
 * @param client - OpenCode client for logging and getProjectId
 * @returns Detected repos sorted by name for deterministic ordering
 */
async function detectRepos(cwd: string, client: OpencodeClient): Promise<DetectedRepo[]> {
	let entries: Awaited<ReturnType<typeof readdir>>
	try {
		entries = await readdir(cwd, { withFileTypes: true })
	} catch (error) {
		logWarn(client, "workspace", `Failed to read directory ${cwd}: ${error}`)
		return []
	}

	// Filter to non-hidden directories only
	const candidates = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))

	// Check each candidate for .git presence in parallel
	const results = await Promise.allSettled(
		candidates.map(async (entry): Promise<DetectedRepo | null> => {
			const dirPath = path.join(cwd, entry.name)
			const gitPath = path.join(dirPath, ".git")

			try {
				await stat(gitPath)
			} catch {
				// No .git entry — not a git repo
				return null
			}

			// .git exists (file or directory) — qualifies as a repo
			try {
				const projectId = await getProjectId(dirPath, client)
				return {
					name: entry.name,
					path: dirPath,
					projectId,
				}
			} catch (error) {
				logWarn(
					client,
					"workspace",
					`Failed to get project ID for ${entry.name}: ${error}`,
				)
				return null
			}
		}),
	)

	// Collect successful results, filter nulls, sort by name
	const repos: DetectedRepo[] = []
	for (const result of results) {
		if (result.status === "fulfilled" && result.value !== null) {
			repos.push(result.value)
		}
	}

	repos.sort((a, b) => a.name.localeCompare(b.name))
	return repos
}

// =============================================================================
// WORKSPACE TARGET RESOLUTION (FR-004, FR-016)
// =============================================================================

/**
 * Resolve the target workspace path and validate it.
 *
 * Path formula: `<cwd>/../worktrees/<name>/`
 *
 * Validates:
 * - Target is not nested inside any source repo (nesting rejection)
 * - Reports unrelated root-level content in the target dir as warnings (FR-016)
 *
 * @param cwd - Absolute path to the session working directory
 * @param name - Validated workspace name
 * @param client - OpenCode client for repo detection and logging
 * @returns Ok with WorkspaceTarget + warnings, or Err with descriptive message
 */
async function resolveWorkspaceTarget(
	cwd: string,
	name: WorkspaceName,
	client: OpencodeClient,
): Promise<Result<WorkspaceTarget & { warnings: string[] }, string>> {
	// Resolve and normalize the target path
	const workspacePath = path.resolve(cwd, "..", "worktrees", name)

	// Auto-detect repos from source cwd
	const repos = await detectRepos(cwd, client)

	if (repos.length === 0) {
		return ResultNs.err(
			`No git repositories detected in ${cwd}. ` +
				"Ensure the working directory contains at least one subdirectory with a .git entry.",
		)
	}

	// Nesting rejection: target must not be inside any source repo
	const normalizedTarget = path.normalize(workspacePath) + path.sep
	for (const repo of repos) {
		const normalizedRepo = path.normalize(repo.path) + path.sep
		if (normalizedTarget.startsWith(normalizedRepo)) {
			return ResultNs.err(
				`Workspace target "${workspacePath}" is nested inside source repo "${repo.name}" at ${repo.path}. ` +
					"The target path must not be inside any detected source repository.",
			)
		}
	}

	// Check for unrelated root-level content in the target directory (FR-016)
	const warnings: string[] = []
	try {
		const targetEntries = await readdir(workspacePath)
		const repoNames = new Set(repos.map((r) => r.name))

		const unrelated = targetEntries.filter((entry) => !repoNames.has(entry))
		if (unrelated.length > 0) {
			warnings.push(
				`Target directory "${workspacePath}" contains unrelated root-level entries: ${unrelated.join(", ")}. ` +
					"These will not be modified, but their presence is unexpected.",
			)
		}
	} catch {
		// Target dir doesn't exist yet — no warnings needed
	}

	return ResultNs.ok({
		name,
		sourceCwd: cwd,
		workspacePath,
		repos,
		warnings,
	})
}

// =============================================================================
// WORKSPACE LOCKING (FR-017)
// =============================================================================

/**
 * Module-level map of workspace path → Mutex for serializing concurrent
 * operations on the same workspace. Different workspace paths can run
 * in parallel; same-path operations are serialized via FIFO mutex.
 */
const workspaceLocks = new Map<string, Mutex>()

/**
 * Acquire a mutex lock for a workspace path.
 *
 * Serializes concurrent `/dev <name>` invocations that target the same
 * workspace path (FR-017). Concurrent invocations with different names
 * MAY run in parallel since they get different mutexes.
 *
 * @param workspacePath - Absolute workspace target path (used as lock key)
 * @returns Release function — caller MUST invoke in a finally block
 *
 * @example
 * ```ts
 * const release = await acquireWorkspaceLock(targetPath)
 * try {
 *   await performWorkspaceSetup(targetPath)
 * } finally {
 *   release()
 * }
 * ```
 */
async function acquireWorkspaceLock(workspacePath: string): Promise<() => void> {
	const normalizedPath = path.normalize(workspacePath)

	let mutex = workspaceLocks.get(normalizedPath)
	if (!mutex) {
		mutex = new Mutex()
		workspaceLocks.set(normalizedPath, mutex)
	}

	await mutex.acquire()
	return () => mutex.release()
}

// =============================================================================
// SINGLE-REPO PATH RESOLUTION (US3 — headless repoPath)
// =============================================================================

/**
 * Resolve a user-provided `repoPath` to a git repo root.
 *
 * Accepts both relative (resolved against `cwd`) and absolute paths.
 * Returns a `DetectedRepo` with `name` = directory basename.
 *
 * Used by `worktree_create` when the caller passes an explicit `repoPath`
 * (User Story 3 / FR-020). The MVP does NOT attempt to walk up parent
 * directories or resolve container paths — only exact repo roots are accepted.
 *
 * @param repoPath - User-supplied path (relative or absolute)
 * @param cwd - Session working directory for resolving relative paths
 * @param client - OpenCode SDK client for `getProjectId`
 * @returns Ok with DetectedRepo, or Err with a descriptive message
 */
async function resolveRepoPath(
	repoPath: string,
	cwd: string,
	client: OpencodeClient,
): Promise<Result<DetectedRepo, string>> {
	// Resolve relative paths against cwd
	const absolutePath = path.isAbsolute(repoPath) ? repoPath : path.resolve(cwd, repoPath)
	const normalizedPath = path.normalize(absolutePath)

	// Verify the path exists and is a directory
	let pathStat: Awaited<ReturnType<typeof stat>>
	try {
		pathStat = await stat(normalizedPath)
	} catch {
		return ResultNs.err(
			`repoPath "${repoPath}" does not exist (resolved to "${normalizedPath}").`,
		)
	}
	if (!pathStat.isDirectory()) {
		return ResultNs.err(
			`repoPath "${repoPath}" is not a directory (resolved to "${normalizedPath}").`,
		)
	}

	// Verify it contains a .git entry (file or directory)
	const gitPath = path.join(normalizedPath, ".git")
	try {
		await stat(gitPath)
	} catch {
		return ResultNs.err(
			`repoPath "${repoPath}" is not a git repository — no .git found at "${normalizedPath}".`,
		)
	}

	// Compute stable project ID
	let projectId: string
	try {
		projectId = await getProjectId(normalizedPath, client)
	} catch (error) {
		return ResultNs.err(
			`Failed to compute project ID for repoPath "${repoPath}": ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	return ResultNs.ok({
		name: path.basename(normalizedPath),
		path: normalizedPath,
		projectId,
	})
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
	type WorkspaceName,
	type DetectedRepo,
	type WorkspaceTarget,
	WORKSPACE_NAME_RE,
	RESERVED_COMMAND_NAMES,
	validateWorkspaceName,
	checkWorkspaceNameAvailable,
	detectRepos,
	resolveWorkspaceTarget,
	resolveRepoPath,
	acquireWorkspaceLock,
}
