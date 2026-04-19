/**
 * Git command helpers, branch validation, and worktree operations.
 *
 * Extracted from worktree.ts to support both the legacy single-repo
 * worktree_create tool and the incoming workspace orchestration layer.
 *
 * All shell execution uses Bun.spawn with explicit arrays — no shell
 * interpolation.
 */

import { mkdir } from "node:fs/promises"
import * as path from "node:path"
import { z } from "zod"

// =============================================================================
// RESULT TYPE
// =============================================================================

/** Success variant of the Result type */
interface OkResult<T> {
	readonly ok: true
	readonly value: T
}

/** Error variant of the Result type */
interface ErrResult<E> {
	readonly ok: false
	readonly error: E
}

/** Result type for fallible operations: {ok: true, value} | {ok: false, error} */
type Result<T, E> = OkResult<T> | ErrResult<E>

const Result = {
	ok: <T>(value: T): OkResult<T> => ({ ok: true, value }),
	err: <E>(error: E): ErrResult<E> => ({ ok: false, error }),
}

// =============================================================================
// BRANCH VALIDATION
// =============================================================================

/**
 * Git branch name validation — blocks invalid refs and shell metacharacters.
 * Characters blocked: control chars (0x00-0x1f, 0x7f), ~^:?*[]\, and shell metacharacters.
 */
function isValidBranchName(name: string): boolean {
	// Check for control characters
	for (let i = 0; i < name.length; i++) {
		const code = name.charCodeAt(i)
		if (code <= 0x1f || code === 0x7f) return false
	}
	// Check for invalid git ref characters and shell metacharacters
	if (/[~^:?*[\]\\;&|`$()]/.test(name)) return false
	return true
}

const branchNameSchema = z
	.string()
	.min(1, "Branch name cannot be empty")
	.refine((name) => !name.startsWith("-"), {
		message: "Branch name cannot start with '-' (prevents option injection)",
	})
	.refine((name) => !name.startsWith("/") && !name.endsWith("/"), {
		message: "Branch name cannot start or end with '/'",
	})
	.refine((name) => !name.includes("//"), {
		message: "Branch name cannot contain '//'",
	})
	.refine((name) => !name.includes("@{"), {
		message: "Branch name cannot contain '@{' (git reflog syntax)",
	})
	.refine((name) => !name.includes(".."), {
		message: "Branch name cannot contain '..'",
	})
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Control character detection is intentional for security
	.refine((name) => !/[\x00-\x1f\x7f ~^:?*[\]\\]/.test(name), {
		message: "Branch name contains invalid characters",
	})
	.max(255, "Branch name too long")
	.refine((name) => isValidBranchName(name), "Contains invalid git ref characters")
	.refine((name) => !name.startsWith(".") && !name.endsWith("."), "Cannot start or end with dot")
	.refine((name) => !name.endsWith(".lock"), "Cannot end with .lock")

// =============================================================================
// GIT COMMAND EXECUTION
// =============================================================================

/**
 * Execute a git command safely using Bun.spawn with explicit array.
 * Avoids shell interpolation entirely by passing args as array.
 */
async function git(args: string[], cwd: string): Promise<Result<string, string>> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		})
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		])
		if (exitCode !== 0) {
			return Result.err(stderr.trim() || `git ${args[0]} failed`)
		}
		return Result.ok(stdout.trim())
	} catch (error) {
		return Result.err(error instanceof Error ? error.message : String(error))
	}
}

// =============================================================================
// BRANCH HELPERS
// =============================================================================

/** Check whether a branch (or any valid rev) exists in the repo. */
async function branchExists(cwd: string, branch: string): Promise<boolean> {
	const result = await git(["rev-parse", "--verify", branch], cwd)
	return result.ok
}

// =============================================================================
// WORKTREE OPERATIONS
// =============================================================================

/**
 * Create a git worktree at the given target path.
 *
 * If `createBranch` is true a new branch is created (equivalent to
 * `git worktree add -b <branch>`).  Otherwise the branch must already
 * exist and is checked out into the new worktree.
 *
 * @param repoRoot    - Absolute path to the repository root (main worktree)
 * @param branch      - Branch name to check out or create
 * @param targetPath  - Absolute path where the worktree directory will live
 * @param createBranch - When true, create a new branch; when false, check out existing
 * @returns The worktree path on success, or an error string on failure
 */
async function createWorktree(
	repoRoot: string,
	branch: string,
	targetPath: string,
	createBranch: boolean,
): Promise<Result<string, string>> {
	// Ensure parent directory exists
	await mkdir(path.dirname(targetPath), { recursive: true })

	if (createBranch) {
		const result = await git(["worktree", "add", "-b", branch, targetPath, "HEAD"], repoRoot)
		return result.ok ? Result.ok(targetPath) : result
	}

	// Checkout existing branch into worktree
	const result = await git(["worktree", "add", targetPath, branch], repoRoot)
	return result.ok ? Result.ok(targetPath) : result
}

/** Force-remove a worktree. */
async function removeWorktree(
	repoRoot: string,
	worktreePath: string,
): Promise<Result<void, string>> {
	const result = await git(["worktree", "remove", "--force", worktreePath], repoRoot)
	return result.ok ? Result.ok(undefined) : Result.err(result.error)
}

/**
 * List all worktree paths registered for a repository.
 *
 * Parses the output of `git worktree list --porcelain`, extracting every
 * line that starts with "worktree " and returning the path portion.
 *
 * @param repoRoot - Absolute path to the repository root
 * @returns Array of absolute worktree paths (includes the main worktree)
 */
async function worktreeList(repoRoot: string): Promise<string[]> {
	const result = await git(["worktree", "list", "--porcelain"], repoRoot)
	if (!result.ok) return []

	const paths: string[] = []
	for (const line of result.value.split("\n")) {
		if (line.startsWith("worktree ")) {
			paths.push(line.slice("worktree ".length))
		}
	}
	return paths
}

/**
 * Prune stale worktree bookkeeping entries.
 *
 * Runs `git worktree prune` which removes administrative data for
 * worktrees whose directories no longer exist on disk.
 *
 * @param repoRoot - Absolute path to the repository root
 */
async function worktreePrune(repoRoot: string): Promise<Result<void, string>> {
	const result = await git(["worktree", "prune"], repoRoot)
	return result.ok ? Result.ok(undefined) : Result.err(result.error)
}

/** Detailed worktree entry with path and branch info. */
interface WorktreeEntry {
	/** Absolute path to the worktree directory. */
	readonly path: string
	/**
	 * Branch name (short form, e.g. "main") or null if HEAD is detached
	 * or the entry is bare.
	 */
	readonly branch: string | null
}

/**
 * List all worktrees for a repository with both path and branch info.
 *
 * Parses `git worktree list --porcelain` output. Each entry block contains:
 * - `worktree <path>`
 * - `HEAD <sha>`
 * - `branch refs/heads/<name>` (or `detached` or `bare`)
 *
 * Entries are separated by blank lines.
 *
 * @param repoRoot - Absolute path to the repository root
 * @returns Array of WorktreeEntry (includes the main worktree)
 */
async function worktreeListDetailed(repoRoot: string): Promise<WorktreeEntry[]> {
	const result = await git(["worktree", "list", "--porcelain"], repoRoot)
	if (!result.ok) return []

	const entries: WorktreeEntry[] = []
	let currentPath: string | null = null
	let currentBranch: string | null = null

	for (const line of result.value.split("\n")) {
		if (line.startsWith("worktree ")) {
			// If we already have a pending entry, push it
			if (currentPath !== null) {
				entries.push({ path: currentPath, branch: currentBranch })
			}
			currentPath = line.slice("worktree ".length)
			currentBranch = null
		} else if (line.startsWith("branch refs/heads/")) {
			currentBranch = line.slice("branch refs/heads/".length)
		} else if (line === "detached" || line === "bare") {
			currentBranch = null
		}
	}

	// Push the last entry
	if (currentPath !== null) {
		entries.push({ path: currentPath, branch: currentBranch })
	}

	return entries
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
	type Result,
	type OkResult,
	type ErrResult,
	type WorktreeEntry,
	Result,
	isValidBranchName,
	branchNameSchema,
	git,
	branchExists,
	createWorktree,
	removeWorktree,
	worktreeList,
	worktreeListDetailed,
	worktreePrune,
}
