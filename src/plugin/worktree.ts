/**
 * OCX Worktree Plugin
 *
 * Creates isolated git worktrees for AI development sessions with
 * seamless terminal spawning across macOS, Windows, and Linux.
 *
 * Inspired by opencode-worktree-session by Felix Anhalt
 * https://github.com/felixAnhalt/opencode-worktree-session
 * License: MIT
 *
 * Rewritten for OCX with production-proven patterns.
 */

import type { Database } from "bun:sqlite"
import { constants as fsConstants } from "node:fs"
import { access, copyFile, cp, mkdir, rm, stat } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { type Plugin, tool } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"
import type { OpencodeClient } from "./kdco-primitives/types"

import { getProjectId } from "./kdco-primitives/get-project-id"

// Extracted modules — config, git, sync
import type { Logger } from "./worktree/config"
import { loadWorktreeConfig } from "./worktree/config"
import { ensureDevCommand } from "./worktree/dev-command"
import {
	Result,
	branchNameSchema,
	git,
	branchExists,
	createWorktree,
	removeWorktree,
} from "./worktree/git"
import { copyFiles, symlinkDirs, runHooks } from "./worktree/sync"
import {
	type ActiveLaunchContext,
	buildSessionLaunchArgv,
	parseActiveLaunchContext,
	serializePersistedLaunchMetadata,
	toPersistedLaunchMetadata,
} from "./worktree/launch-context"
import {
	addSession,
	clearPendingDelete,
	getPendingDelete,
	getSession,
	getWorktreePath,
	initStateDb,
	removeSession,
	setPendingDelete,
} from "./worktree/state"
import { openTerminal, type TerminalResult } from "./worktree/terminal"
import { orchestrateWorkspaceCreate } from "./worktree/workspace-create"
import { resolveRepoPath } from "./worktree/workspace"
import { buildHeadlessResult } from "./worktree/workspace-session"

/** Maximum retries for database initialization */
const DB_MAX_RETRIES = 3

/** Delay between retry attempts in milliseconds */
const DB_RETRY_DELAY_MS = 100

/** Maximum depth to traverse session parent chain */
const MAX_SESSION_CHAIN_DEPTH = 10

// =============================================================================
// TYPES & SCHEMAS — now imported from extracted modules:
//   Result, branchNameSchema      → ./worktree/git
//   Logger, WorktreeConfig, etc.  → ./worktree/config
//   copyFiles, symlinkDirs, etc.  → ./worktree/sync
// =============================================================================

// =============================================================================
// ERROR TYPES
// =============================================================================

class WorktreeError extends Error {
	constructor(
		message: string,
		public readonly operation: string,
		public readonly cause?: unknown,
	) {
		super(`${operation}: ${message}`)
		this.name = "WorktreeError"
	}
}

type ResolveExecutable = (command: string) => string | null | undefined
type ValidateProfileAvailability = (
	ocxBin: string,
	profile: string,
) => Promise<Result<void, string>>

interface LaunchExecutableValidationOptions {
	resolveExecutable?: ResolveExecutable
	pathExists?: (absolutePath: string) => Promise<boolean>
}

export function isPathLikeCommand(command: string): boolean {
	return command.includes("/") || command.includes("\\")
}

function resolveStableLaunchBinaryPath(
	ocxBin: string,
	baseDirectory: string,
	resolveExecutable: ResolveExecutable,
): Result<string, string> {
	if (isPathLikeCommand(ocxBin)) {
		const resolvedPath = path.isAbsolute(ocxBin) ? ocxBin : path.resolve(baseDirectory, ocxBin)
		return Result.ok(resolvedPath)
	}

	const resolvedFromPath = resolveExecutable(ocxBin)
	if (!resolvedFromPath) {
		return Result.err(`Configured OCX binary "${ocxBin}" is not available in PATH.`)
	}

	const resolvedPath = path.isAbsolute(resolvedFromPath)
		? resolvedFromPath
		: path.resolve(baseDirectory, resolvedFromPath)

	return Result.ok(resolvedPath)
}

async function pathPointsToLaunchableBinary(absolutePath: string): Promise<boolean> {
	try {
		const stats = await stat(absolutePath)
		if (stats.isDirectory()) {
			return false
		}

		await access(absolutePath, fsConstants.X_OK)
		return true
	} catch {
		return false
	}
}

export async function ensureLaunchContextExecutable(
	launchContext: ActiveLaunchContext,
	baseDirectory: string,
	options: LaunchExecutableValidationOptions = {},
): Promise<ActiveLaunchContext> {
	if (launchContext.mode === "plain") {
		return launchContext
	}

	const { ocxBin, profile } = launchContext
	const resolveExecutable = options.resolveExecutable ?? ((command: string) => Bun.which(command))
	const pathExists = options.pathExists ?? pathPointsToLaunchableBinary
	const resolvedPathResult = resolveStableLaunchBinaryPath(ocxBin, baseDirectory, resolveExecutable)
	if (!resolvedPathResult.ok) {
		throw new WorktreeError(
			`${resolvedPathResult.error} Repair the parent OCX profile (${profile}) and recreate this worktree session.`,
			"launch",
		)
	}

	const resolvedPath = resolvedPathResult.value
	const isLaunchable = await pathExists(resolvedPath)
	if (!isLaunchable) {
		throw new WorktreeError(
			`Configured OCX binary "${ocxBin}" resolved to "${resolvedPath}" but is missing or stale. Repair the parent OCX profile (${profile}) and recreate this worktree session.`,
			"launch",
		)
	}

	return {
		mode: "ocx",
		ocxBin: resolvedPath,
		profile,
	}
}

export async function validateOcxProfileAvailability(
	ocxBin: string,
	profile: string,
): Promise<Result<void, string>> {
	try {
		const proc = Bun.spawn([ocxBin, "profile", "show", profile, "--global", "--json"], {
			stdout: "pipe",
			stderr: "pipe",
		})
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		])

		if (exitCode === 0) {
			return Result.ok(undefined)
		}

		const detail = stderr.trim() || stdout.trim() || `exit ${exitCode}`
		return Result.err(detail)
	} catch (error) {
		return Result.err(error instanceof Error ? error.message : String(error))
	}
}

export async function ensureLaunchContextProfile(
	launchContext: ActiveLaunchContext,
	validateProfileAvailability: ValidateProfileAvailability = validateOcxProfileAvailability,
): Promise<void> {
	if (launchContext.mode === "plain") {
		return
	}

	const validationResult = await validateProfileAvailability(
		launchContext.ocxBin,
		launchContext.profile,
	)
	if (validationResult.ok) {
		return
	}

	throw new WorktreeError(
		`Configured OCX profile "${launchContext.profile}" is missing or stale. ${validationResult.error} Repair the parent OCX profile and recreate this worktree session.`,
		"launch",
	)
}

// =============================================================================
// SESSION FORKING HELPERS
// =============================================================================

/**
 * Check if a path exists, distinguishing ENOENT from other errors (Law 4)
 */
async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath)
		return true
	} catch (e: unknown) {
		if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
			return false
		}
		throw e // Re-throw permission errors, etc.
	}
}

/**
 * Copy file if source exists. Returns true if copied, false if source doesn't exist.
 * Throws on copy failure (Law 4: Fail Loud)
 */
async function copyIfExists(src: string, dest: string): Promise<boolean> {
	if (!(await pathExists(src))) return false
	await copyFile(src, dest)
	return true
}

/**
 * Copy directory contents if source exists.
 * @param src - Source directory path
 * @param dest - Destination directory path
 * @returns true if copy was performed, false if source doesn't exist
 */
async function copyDirIfExists(src: string, dest: string): Promise<boolean> {
	if (!(await pathExists(src))) return false
	await cp(src, dest, { recursive: true })
	return true
}

interface ForkResult {
	forkedSession: { id: string }
	rootSessionId: string
	planCopied: boolean
	delegationsCopied: boolean
}

interface FinalizeWorktreeLaunchOptions {
	database: Database
	worktreePath: string
	launchArgv: string[]
	branch: string
	forkedSessionId: string
	sessionRecord: {
		id: string
		branch: string
		path: string
		createdAt: string
		launchMode: "plain" | "ocx"
		profile: string | null
		ocxBin: string | null
	}
	log: Logger
	openTerminalFn?: (cwd: string, argv?: string[], windowName?: string) => Promise<TerminalResult>
	addSessionFn?: typeof addSession
	deleteForkedSessionFn?: (sessionId: string) => Promise<void>
}

export async function finalizeWorktreeLaunch(
	options: FinalizeWorktreeLaunchOptions,
): Promise<TerminalResult> {
	const openTerminalFn = options.openTerminalFn ?? openTerminal
	const addSessionFn = options.addSessionFn ?? addSession
	const deleteForkedSessionFn =
		options.deleteForkedSessionFn ??
		(async (_sessionId: string) => {
			// Default no-op for tests without cleanup side effects.
		})

	const terminalResult = await openTerminalFn(
		options.worktreePath,
		options.launchArgv,
		options.branch,
	)

	if (!terminalResult.success) {
		await deleteForkedSessionFn(options.forkedSessionId).catch((cleanupError) => {
			options.log.warn(
				`[worktree] Failed to clean up forked session ${options.forkedSessionId} after launch failure: ${cleanupError}`,
			)
		})
		return terminalResult
	}

	addSessionFn(options.database, options.sessionRecord)
	return terminalResult
}

/**
 * Fork a session and copy associated plans/delegations.
 * Cleans up forked session on failure (atomic operation).
 */
async function forkWithContext(
	client: OpencodeClient,
	sessionId: string,
	projectId: string,
	getRootSessionIdFn: (sessionId: string) => Promise<string>,
): Promise<ForkResult> {
	// Guard clauses (Law 1)
	if (!client) throw new WorktreeError("client is required", "forkWithContext")
	if (!sessionId) throw new WorktreeError("sessionId is required", "forkWithContext")
	if (!projectId) throw new WorktreeError("projectId is required", "forkWithContext")

	// Get root session ID with error wrapping
	let rootSessionId: string
	try {
		rootSessionId = await getRootSessionIdFn(sessionId)
	} catch (e) {
		throw new WorktreeError("Failed to get root session ID", "forkWithContext", e)
	}

	// Fork session
	const forkedSessionResponse = await client.session.fork({
		path: { id: sessionId },
		body: {},
	})
	const forkedSession = forkedSessionResponse.data
	if (!forkedSession?.id) {
		throw new WorktreeError("Failed to fork session: no session data returned", "forkWithContext")
	}

	// Copy data with cleanup on failure
	let planCopied = false
	let delegationsCopied = false

	try {
		const workspaceBase = path.join(os.homedir(), ".local", "share", "opencode", "workspace")
		const delegationsBase = path.join(os.homedir(), ".local", "share", "opencode", "delegations")

		const destWorkspaceDir = path.join(workspaceBase, projectId, forkedSession.id)
		const destDelegationsDir = path.join(delegationsBase, projectId, forkedSession.id)

		await mkdir(destWorkspaceDir, { recursive: true })
		await mkdir(destDelegationsDir, { recursive: true })

		// Copy plan
		const srcPlan = path.join(workspaceBase, projectId, rootSessionId, "plan.md")
		const destPlan = path.join(destWorkspaceDir, "plan.md")
		planCopied = await copyIfExists(srcPlan, destPlan)

		// Copy delegations
		const srcDelegations = path.join(delegationsBase, projectId, rootSessionId)
		delegationsCopied = await copyDirIfExists(srcDelegations, destDelegationsDir)
	} catch (error) {
		client.app
			.log({
				body: {
					service: "worktree",
					level: "error",
					message: `forkWithContext: Copy failed, cleaning up forked session: ${error}`,
				},
			})
			.catch(() => {})
		// Clean up orphaned directories
		const workspaceBase = path.join(os.homedir(), ".local", "share", "opencode", "workspace")
		const delegationsBase = path.join(os.homedir(), ".local", "share", "opencode", "delegations")
		const destWorkspaceDir = path.join(workspaceBase, projectId, forkedSession.id)
		const destDelegationsDir = path.join(delegationsBase, projectId, forkedSession.id)
		await rm(destWorkspaceDir, { recursive: true, force: true }).catch((e) => {
			client.app
				.log({
					body: {
						service: "worktree",
						level: "error",
						message: `forkWithContext: Failed to clean up workspace dir ${destWorkspaceDir}: ${e}`,
					},
				})
				.catch(() => {})
		})
		await rm(destDelegationsDir, { recursive: true, force: true }).catch((e) => {
			client.app
				.log({
					body: {
						service: "worktree",
						level: "error",
						message: `forkWithContext: Failed to clean up delegations dir ${destDelegationsDir}: ${e}`,
					},
				})
				.catch(() => {})
		})
		await client.session.delete({ path: { id: forkedSession.id } }).catch((e) => {
			client.app
				.log({
					body: {
						service: "worktree",
						level: "error",
						message: `forkWithContext: Failed to clean up forked session ${forkedSession.id}: ${e}`,
					},
				})
				.catch(() => {})
		})
		throw new WorktreeError(
			`Failed to copy session data: ${error instanceof Error ? error.message : String(error)}`,
			"forkWithContext",
			error,
		)
	}

	return { forkedSession, rootSessionId, planCopied, delegationsCopied }
}

// =============================================================================
// MODULE-LEVEL STATE
// =============================================================================

/** Database instance - initialized once per plugin lifecycle */
let db: Database | null = null

/** Project root path - stored on first initialization */
let projectRoot: string | null = null

/** Flag to prevent duplicate cleanup handler registration */
let cleanupRegistered = false

/**
 * Register process cleanup handlers for graceful database shutdown.
 * Ensures WAL checkpoint and proper close on process termination.
 *
 * NOTE: process.once() is an EventEmitter method that never throws.
 * The boolean guard is defense-in-depth for idempotency, not error recovery.
 *
 * @param database - The database instance to clean up
 */
function registerCleanupHandlers(database: Database): void {
	if (cleanupRegistered) return // Early exit guard
	cleanupRegistered = true

	const cleanup = () => {
		try {
			database.exec("PRAGMA wal_checkpoint(TRUNCATE)")
			database.close()
		} catch {
			// Best effort cleanup - process is exiting anyway
		}
	}

	process.once("SIGTERM", cleanup)
	process.once("SIGINT", cleanup)
	process.once("beforeExit", cleanup)
}

/**
 * Get the database instance, initializing if needed.
 * Includes retry logic for transient initialization failures.
 *
 * @returns Database instance
 * @throws {Error} if initialization fails after all retries
 */
async function getDb(log: Logger): Promise<Database> {
	if (db) return db

	if (!projectRoot) {
		throw new Error("Database not initialized: projectRoot not set. Call initDb() first.")
	}

	let lastError: Error | null = null

	for (let attempt = 1; attempt <= DB_MAX_RETRIES; attempt++) {
		try {
			db = await initStateDb(projectRoot)
			registerCleanupHandlers(db)
			return db
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error))
			log.warn(`Database init attempt ${attempt}/${DB_MAX_RETRIES} failed: ${lastError.message}`)

			if (attempt < DB_MAX_RETRIES) {
				await Bun.sleep(DB_RETRY_DELAY_MS)
			}
		}
	}

	throw new Error(
		`Failed to initialize database after ${DB_MAX_RETRIES} attempts: ${lastError?.message}`,
	)
}

/**
 * Initialize the database with the project root path.
 * Must be called once before any getDb() calls.
 */
async function initDb(root: string, log: Logger): Promise<Database> {
	projectRoot = root
	return getDb(log)
}

// =============================================================================
// PLUGIN ENTRY
// =============================================================================

export const WorktreePlugin: Plugin = async (ctx) => {
	const { directory, client } = ctx

	const log = {
		debug: (msg: string) =>
			client.app
				.log({ body: { service: "worktree", level: "debug", message: msg } })
				.catch(() => {}),
		info: (msg: string) =>
			client.app
				.log({ body: { service: "worktree", level: "info", message: msg } })
				.catch(() => {}),
		warn: (msg: string) =>
			client.app
				.log({ body: { service: "worktree", level: "warn", message: msg } })
				.catch(() => {}),
		error: (msg: string) =>
			client.app
				.log({ body: { service: "worktree", level: "error", message: msg } })
				.catch(() => {}),
	}

	// Initialize SQLite database
	const database = await initDb(directory, log)

	// FR-024: Auto-create .opencode/commands/dev.md so users can invoke
	// /dev <name> as the slash-command surface for worktree_workspace_create.
	// Idempotent — never overwrites user-modified content.
	await ensureDevCommand(directory, log)

	return {
		tool: {
			worktree_create: tool({
				description:
					"Create a single-repo git worktree for isolated development. " +
					"By default, forks the current session and opens a new terminal with OpenCode running in the worktree. " +
					"Set headless: true to skip terminal spawn and session fork — returns { worktreePath, projectId } for programmatic callers. " +
					"Set repoPath to target a specific git repository instead of the current session directory. " +
					"Files and directories are synced per .opencode/worktree.jsonc; postCreate hooks run automatically.",
				args: {
					branch: tool.schema
						.string()
						.describe("Branch name for the worktree (e.g., 'feature/dark-mode')"),
					baseBranch: tool.schema
						.string()
						.optional()
						.describe("Base branch to create from (defaults to HEAD)"),
					headless: tool.schema
						.boolean()
						.optional()
						.default(false)
						.describe(
							"Skip terminal spawn and session fork. Returns { worktreePath, projectId } for SDK workflows.",
						),
					repoPath: tool.schema
						.string()
						.optional()
						.describe(
							"Path to a specific git repository (absolute or relative to cwd). Defaults to the current session directory.",
						),
				},
				async execute(args, toolCtx) {
					// Validate branch name at boundary
					const branchResult = branchNameSchema.safeParse(args.branch)
					if (!branchResult.success) {
						return `❌ Invalid branch name: ${branchResult.error.issues[0]?.message}`
					}

					// Validate base branch name at boundary
					if (args.baseBranch) {
						const baseResult = branchNameSchema.safeParse(args.baseBranch)
						if (!baseResult.success) {
							return `❌ Invalid base branch name: ${baseResult.error.issues[0]?.message}`
						}
					}

					// -----------------------------------------------------------
					// Resolve repo root: repoPath → explicit repo, else session dir
					// -----------------------------------------------------------
					let repoRoot: string
					let repoProjectId: string | undefined

					if (args.repoPath) {
						const repoResult = await resolveRepoPath(args.repoPath, directory, client)
						if (!repoResult.ok) {
							return `❌ ${repoResult.error}`
						}
						repoRoot = repoResult.value.path
						repoProjectId = repoResult.value.projectId
					} else {
						repoRoot = directory
					}

					// -----------------------------------------------------------
					// Non-headless (interactive) path needs launch context validation
					// -----------------------------------------------------------
					if (!args.headless) {
						let activeLaunchContext: ActiveLaunchContext
						try {
							activeLaunchContext = parseActiveLaunchContext(
								process.env as Record<string, string | undefined>,
							)
							activeLaunchContext = await ensureLaunchContextExecutable(
								activeLaunchContext,
								repoRoot,
							)
							await ensureLaunchContextProfile(activeLaunchContext)
						} catch (error) {
							return `❌ ${error instanceof Error ? error.message : String(error)}`
						}

						// Load config first so worktreePath is available for createWorktree
						const worktreeConfig = await loadWorktreeConfig(repoRoot, log)

						// Compute worktree target path and whether we need a new branch
						const targetPath = await getWorktreePath(
							repoRoot,
							args.branch,
							worktreeConfig.worktreePath,
						)
						const needsNewBranch = !(await branchExists(repoRoot, args.branch))

						// Create worktree — use extracted helper for the common case,
						// but handle baseBranch directly when creating a new branch from
						// a non-HEAD base (the extracted createWorktree always uses HEAD).
						let result: Result<string, string>
						if (needsNewBranch && args.baseBranch) {
							await mkdir(path.dirname(targetPath), { recursive: true })
							const gitResult = await git(
								["worktree", "add", "-b", args.branch, targetPath, args.baseBranch],
								repoRoot,
							)
							result = gitResult.ok ? Result.ok(targetPath) : gitResult
						} else {
							result = await createWorktree(repoRoot, args.branch, targetPath, needsNewBranch)
						}
						if (!result.ok) {
							return `❌ Failed to create worktree: ${result.error}`
						}

						const worktreePath = result.value

						// Sync files from main worktree
						const mainWorktreePath = repoRoot

						// Copy files
						if (worktreeConfig.sync.copyFiles.length > 0) {
							await copyFiles(mainWorktreePath, worktreePath, worktreeConfig.sync.copyFiles, log)
						}

						// Symlink directories
						if (worktreeConfig.sync.symlinkDirs.length > 0) {
							await symlinkDirs(mainWorktreePath, worktreePath, worktreeConfig.sync.symlinkDirs, log)
						}

						// Run postCreate hooks
						if (worktreeConfig.hooks.postCreate.length > 0) {
							const hookTimeoutMs = worktreeConfig.hooks.timeout > 0
								? worktreeConfig.hooks.timeout
								: undefined
							await runHooks(worktreeConfig.hooks.postCreate, worktreePath, log, hookTimeoutMs)
						}

						// Fork session with context (replaces --session resume)
						const projectId = await getProjectId(worktreePath, client)
						const { forkedSession, planCopied, delegationsCopied } = await forkWithContext(
							client,
							toolCtx.sessionID,
							projectId,
							async (sid) => {
								// Walk up parentID chain to find root session
								let currentId = sid
								for (let depth = 0; depth < MAX_SESSION_CHAIN_DEPTH; depth++) {
									const session = await client.session.get({ path: { id: currentId } })
									if (!session.data?.parentID) return currentId
									currentId = session.data.parentID
								}
								return currentId
							},
						)

						log.debug(
							`Forked session ${forkedSession.id}, plan: ${planCopied}, delegations: ${delegationsCopied}`,
						)
						const persistedLaunchMetadata = toPersistedLaunchMetadata(activeLaunchContext)
						const launchArgv = buildSessionLaunchArgv(forkedSession.id, persistedLaunchMetadata)
						const serializedLaunchMetadata = serializePersistedLaunchMetadata(persistedLaunchMetadata)

						const terminalResult = await finalizeWorktreeLaunch({
							database,
							worktreePath,
							launchArgv,
							branch: args.branch,
							forkedSessionId: forkedSession.id,
							sessionRecord: {
								id: forkedSession.id,
								branch: args.branch,
								path: worktreePath,
								createdAt: new Date().toISOString(),
								launchMode: serializedLaunchMetadata.launchMode,
								profile: serializedLaunchMetadata.profile,
								ocxBin: serializedLaunchMetadata.ocxBin,
							},
							log,
							deleteForkedSessionFn: async (sessionId: string) => {
								await client.session.delete({ path: { id: sessionId } })
							},
						})

						if (!terminalResult.success) {
							return `❌ Failed to launch worktree terminal: ${terminalResult.error ?? "unknown error"}\nWorktree created at ${worktreePath}. Verify launch settings and retry.`
						}

						return `Worktree created at ${worktreePath}\n\nA new terminal has been opened with OpenCode.`
					}

					// -----------------------------------------------------------
					// Headless path: create worktree + sync + hooks, skip terminal
					// and session fork. Return { worktreePath, projectId }.
					// -----------------------------------------------------------
					const worktreeConfig = await loadWorktreeConfig(repoRoot, log)

					const targetPath = await getWorktreePath(
						repoRoot,
						args.branch,
						worktreeConfig.worktreePath,
					)
					const needsNewBranch = !(await branchExists(repoRoot, args.branch))

					let result: Result<string, string>
					if (needsNewBranch && args.baseBranch) {
						await mkdir(path.dirname(targetPath), { recursive: true })
						const gitResult = await git(
							["worktree", "add", "-b", args.branch, targetPath, args.baseBranch],
							repoRoot,
						)
						result = gitResult.ok ? Result.ok(targetPath) : gitResult
					} else {
						result = await createWorktree(repoRoot, args.branch, targetPath, needsNewBranch)
					}
					if (!result.ok) {
						return `❌ Failed to create worktree: ${result.error}`
					}

					const worktreePath = result.value
					const mainWorktreePath = repoRoot

					// Copy files
					if (worktreeConfig.sync.copyFiles.length > 0) {
						await copyFiles(mainWorktreePath, worktreePath, worktreeConfig.sync.copyFiles, log)
					}

					// Symlink directories
					if (worktreeConfig.sync.symlinkDirs.length > 0) {
						await symlinkDirs(mainWorktreePath, worktreePath, worktreeConfig.sync.symlinkDirs, log)
					}

					// Run postCreate hooks
					if (worktreeConfig.hooks.postCreate.length > 0) {
						const hookTimeoutMs = worktreeConfig.hooks.timeout > 0
							? worktreeConfig.hooks.timeout
							: undefined
						await runHooks(worktreeConfig.hooks.postCreate, worktreePath, log, hookTimeoutMs)
					}

					// Compute project ID (use pre-resolved one from repoPath, or compute fresh)
					const projectId = repoProjectId ?? await getProjectId(worktreePath, client)

					return JSON.stringify(buildHeadlessResult(worktreePath, projectId))
				},
			}),

			worktree_delete: tool({
				description:
					"Mark the current session's worktree for cleanup. " +
					"On session idle, runs preDelete hooks, commits all uncommitted changes, " +
					"and removes the git worktree. Only works inside a worktree-backed session.",
				args: {
					reason: tool.schema
						.string()
						.describe("Brief explanation of why you are deleting this worktree"),
				},
				async execute(_args, toolCtx) {
					// Find current session's worktree
					const session = getSession(database, toolCtx?.sessionID ?? "")
					if (!session) {
						return `No worktree associated with this session. This tool only works inside a session created by worktree_create.`
					}

					// Set pending delete for session.idle (atomic operation)
					setPendingDelete(database, { branch: session.branch, path: session.path }, client)

					return `Worktree "${session.branch}" at ${session.path} marked for cleanup. It will be removed when this session becomes idle.`
				},
			}),

			worktree_workspace_create: tool({
				description:
					"Create or reconcile a multi-repo workspace with parallel worktrees. " +
					"Auto-detects git repositories in the current directory, creates one worktree per repo " +
					"under <cwd>/../worktrees/<name>/, runs per-repo sync and hooks from each repo's " +
					".opencode/worktree.jsonc, and forks a workspace-level session. " +
					"Returns { workspacePath, sessionId, sessionDisposition, repos[], warnings[] }. " +
					"Re-running with the same name reconciles: healthy worktrees are kept, " +
					"missing or failed ones are recreated. Headless — no terminal is opened.",
				args: {
					name: tool.schema
						.string()
						.describe(
							"Workspace name (1–64 chars, alphanumeric/underscore/hyphen, starts with alphanumeric)",
						),
				},
				async execute(args, toolCtx) {
					const result = await orchestrateWorkspaceCreate(
						directory,
						args.name,
						toolCtx.sessionID,
						client,
						log,
					)

					if (!result.ok) {
						return `❌ Failed to create workspace: ${result.error}`
					}

					return JSON.stringify(result.value, null, 2)
				},
			}),
		},

		event: async ({ event }: { event: Event }): Promise<void> => {
			if (event.type !== "session.idle") return

			// Handle pending delete
			const pendingDelete = getPendingDelete(database)
			if (pendingDelete) {
				const { path: worktreePath, branch } = pendingDelete

				// Run preDelete hooks before cleanup
				const config = await loadWorktreeConfig(directory, log)
				if (config.hooks.preDelete.length > 0) {
					await runHooks(config.hooks.preDelete, worktreePath, log)
				}

				// Commit any uncommitted changes
				const addResult = await git(["add", "-A"], worktreePath)
				if (!addResult.ok) log.warn(`[worktree] git add failed: ${addResult.error}`)

				const commitResult = await git(
					["commit", "-m", "chore(worktree): session snapshot", "--allow-empty"],
					worktreePath,
				)
				if (!commitResult.ok) log.warn(`[worktree] git commit failed: ${commitResult.error}`)

				// Remove worktree
				const removeResult = await removeWorktree(directory, worktreePath)
				if (!removeResult.ok) {
					log.warn(`[worktree] Failed to remove worktree: ${removeResult.error}`)
				}

				// Clear pending delete atomically
				clearPendingDelete(database)

				// Remove session from database
				removeSession(database, branch)
			}
		},
	}
}

export default WorktreePlugin
