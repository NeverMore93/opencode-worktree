/**
 * File synchronization, symlink management, path safety, and hook execution
 * for worktree lifecycle operations.
 *
 * Extracted from worktree.ts to isolate sync/hook concerns.
 * These are pure utility functions with no state or session dependencies.
 *
 * @module worktree/sync
 */

import { mkdir, rm, stat, symlink } from "node:fs/promises"
import * as path from "node:path"
import { withTimeout } from "../kdco-primitives/with-timeout"

// ---------------------------------------------------------------------------
// Types — imported from sibling modules
// ---------------------------------------------------------------------------

import type { Logger } from "./config"
import { type Result, Result as ResultNs } from "./git"

// ---------------------------------------------------------------------------
// Path Safety
// ---------------------------------------------------------------------------

/**
 * Validate that a path is safe (no escape from base directory).
 *
 * Rejects absolute paths, obvious traversal (`..`), and resolved paths
 * that land outside `baseDir`.
 */
export function isPathSafe(filePath: string, baseDir: string, log: Logger): boolean {
	// Reject absolute paths
	if (path.isAbsolute(filePath)) {
		log.warn(`[worktree] Rejected absolute path: ${filePath}`)
		return false
	}
	// Reject obvious path traversal
	if (filePath.includes("..")) {
		log.warn(`[worktree] Rejected path traversal: ${filePath}`)
		return false
	}
	// Verify resolved path stays within base directory
	const resolved = path.resolve(baseDir, filePath)
	if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
		log.warn(`[worktree] Path escapes base directory: ${filePath}`)
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// File Copy
// ---------------------------------------------------------------------------

/**
 * Copy files from source directory to target directory.
 * Skips missing files silently (production pattern).
 */
export async function copyFiles(
	sourceDir: string,
	targetDir: string,
	files: string[],
	log: Logger,
): Promise<void> {
	for (const file of files) {
		if (!isPathSafe(file, sourceDir, log)) continue

		const sourcePath = path.join(sourceDir, file)
		const targetPath = path.join(targetDir, file)

		try {
			const sourceFile = Bun.file(sourcePath)
			if (!(await sourceFile.exists())) {
				log.debug(`[worktree] Skipping missing file: ${file}`)
				continue
			}

			// Ensure target directory exists
			const targetFileDir = path.dirname(targetPath)
			await mkdir(targetFileDir, { recursive: true })

			// Copy file
			await Bun.write(targetPath, sourceFile)
			log.info(`[worktree] Copied: ${file}`)
		} catch (error) {
			const isNotFound =
				error instanceof Error &&
				(error.message.includes("ENOENT") || error.message.includes("no such file"))
			if (isNotFound) {
				log.debug(`[worktree] Skipping missing: ${file}`)
			} else {
				log.warn(`[worktree] Failed to copy ${file}: ${error}`)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Symlink Directories
// ---------------------------------------------------------------------------

/**
 * Create symlinks for directories from source to target.
 * Uses absolute paths for symlink targets.
 */
export async function symlinkDirs(
	sourceDir: string,
	targetDir: string,
	dirs: string[],
	log: Logger,
): Promise<void> {
	for (const dir of dirs) {
		if (!isPathSafe(dir, sourceDir, log)) continue

		const sourcePath = path.join(sourceDir, dir)
		const targetPath = path.join(targetDir, dir)

		try {
			// Check if source directory exists
			const fileStat = await stat(sourcePath).catch(() => null)
			if (!fileStat || !fileStat.isDirectory()) {
				log.debug(`[worktree] Skipping missing directory: ${dir}`)
				continue
			}

			// Ensure parent directory exists
			const targetParentDir = path.dirname(targetPath)
			await mkdir(targetParentDir, { recursive: true })

			// Remove existing target if it exists (might be empty dir from git)
			await rm(targetPath, { recursive: true, force: true })

			// Create symlink (use absolute path for source)
			await symlink(sourcePath, targetPath, "dir")
			log.info(`[worktree] Symlinked: ${dir}`)
		} catch (error) {
			log.warn(`[worktree] Failed to symlink ${dir}: ${error}`)
		}
	}
}

// ---------------------------------------------------------------------------
// Hook Execution
// ---------------------------------------------------------------------------

/**
 * Run hook commands in the worktree directory.
 *
 * When `timeoutMs` is provided, each command is wrapped with `withTimeout`
 * so a hung hook does not block the entire lifecycle (FR-011).
 * When omitted, hooks run without a timeout — preserving legacy behaviour.
 */
export async function runHooks(
	hooks: string[],
	cwd: string,
	log: Logger,
	timeoutMs?: number,
): Promise<Result<void, string>> {
	for (const command of hooks) {
		log.info(`[worktree] Running hook: ${command}`)
		try {
			const executeHook = async (): Promise<void> => {
				// Use shell to properly handle quoted arguments and complex commands
				const result = Bun.spawnSync(["bash", "-c", command], {
					cwd,
					stdout: "inherit",
					stderr: "pipe",
				})
				if (result.exitCode !== 0) {
					const stderr = result.stderr?.toString() || ""
					throw new Error(
						`Hook failed (exit ${result.exitCode}): ${command}${stderr ? `\n${stderr}` : ""}`,
					)
				}
			}

			if (timeoutMs !== undefined) {
				await withTimeout(
					executeHook(),
					timeoutMs,
					`[worktree] Hook timed out after ${timeoutMs}ms: ${command}`,
				)
			} else {
				await executeHook()
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			log.warn(`[worktree] Hook error: ${message}`)
			return ResultNs.err(message)
		}
	}
	return ResultNs.ok(undefined)
}
