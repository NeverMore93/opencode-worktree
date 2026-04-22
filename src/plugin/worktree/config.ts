/**
 * Worktree plugin configuration schema, loading, and related helpers.
 *
 * Reads/creates `.opencode/worktree.jsonc` with JSONC support (comments allowed).
 * Extracted from worktree.ts for reuse by workspace-level orchestration.
 */

import { mkdir } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { z } from "zod"

// =============================================================================
// LOGGER INTERFACE
// =============================================================================

/** Logger interface for structured logging */
export interface Logger {
	debug: (msg: string) => void
	info: (msg: string) => void
	warn: (msg: string) => void
	error: (msg: string) => void
}

// =============================================================================
// CONFIG SCHEMA
// =============================================================================

/**
 * Worktree plugin configuration schema.
 * Config file: .opencode/worktree.jsonc
 */
export const worktreeConfigSchema = z.object({
	/** Custom base path for worktree storage. Supports ~ for home directory. */
	worktreePath: z.string().optional(),
	sync: z
		.object({
			/** Files to copy from main worktree (relative paths only) */
			copyFiles: z.array(z.string()).default([]),
			/** Directories to symlink from main worktree (saves disk space) */
			symlinkDirs: z.array(z.string()).default([]),
			/** Patterns to exclude from copying (reserved for future use) */
			exclude: z.array(z.string()).default([]),
		})
		.default(() => ({ copyFiles: [], symlinkDirs: [], exclude: [] })),
	hooks: z
		.object({
			/** Commands to run after worktree creation */
			postCreate: z.array(z.string()).default([]),
			/** Commands to run before worktree deletion */
			preDelete: z.array(z.string()).default([]),
			/**
			 * Timeout in milliseconds for each hook command.
			 * Applies to both single-repo and workspace-level hooks.
			 * Default: 1800000 (30 minutes). Set to 0 to disable timeout.
			 */
			timeout: z.number().int().min(0).default(1_800_000),
		})
		.default(() => ({ postCreate: [], preDelete: [], timeout: 1_800_000 })),
})

export type WorktreeConfig = z.infer<typeof worktreeConfigSchema>

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Resolve a path that may contain a leading `~` to the user's home directory.
 */
export function resolveHomePath(p: string): string {
	if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
		return path.join(os.homedir(), p.slice(1))
	}
	return p
}

// =============================================================================
// CONFIG LOADING
// =============================================================================

/**
 * Load worktree-specific configuration from .opencode/worktree.jsonc
 * Auto-creates config file with helpful defaults if it doesn't exist.
 */
export async function loadWorktreeConfig(directory: string, log: Logger): Promise<WorktreeConfig> {
	const configPath = path.join(directory, ".opencode", "worktree.jsonc")

	try {
		const file = Bun.file(configPath)
		if (!(await file.exists())) {
			// Auto-create config with helpful defaults and comments
			const defaultConfig = `{
  "$schema": "https://registry.kdco.dev/schemas/worktree.json",

  // Worktree plugin configuration
  // Documentation: https://github.com/kdcokenny/ocx
  //
  // This config applies to both single-repo worktrees (worktree_create)
  // and multi-repo workspaces (worktree_workspace_create / /dev).
  // In workspace mode, each detected repo loads its own .opencode/worktree.jsonc.

  // Custom base path for single-repo worktree storage (supports ~)
  // Default: ~/.local/share/opencode/worktree
  // Workspace worktrees always use <cwd>/../worktrees/<name>/
  // "worktreePath": "~/my-worktrees",

  "sync": {
    // Files to copy from main worktree to new worktrees
    // Example: [".env", ".env.local", "dev.sqlite"]
    "copyFiles": [],

    // Directories to symlink (saves disk space)
    // Example: ["node_modules"]
    "symlinkDirs": [],

    // Patterns to exclude from copying
    "exclude": []
  },

  "hooks": {
    // Commands to run after worktree creation
    // In workspace mode, hooks run in parallel across repos
    // Example: ["pnpm install", "docker compose up -d"]
    "postCreate": [],

    // Commands to run before worktree deletion (single-repo only)
    // Example: ["docker compose down"]
    "preDelete": [],

    // Timeout in milliseconds for each hook command (default: 1800000 = 30 min)
    // Set to 0 to disable. Applies to both single-repo and workspace hooks.
    // "timeout": 1800000
  }
}
`
			// Ensure .opencode directory exists
			await mkdir(path.join(directory, ".opencode"), { recursive: true })
			await Bun.write(configPath, defaultConfig)
			log.info(`[worktree] Created default config: ${configPath}`)
			return worktreeConfigSchema.parse({})
		}

		const content = await file.text()
		// Use proper JSONC parser (handles comments in strings correctly)
		const parsed = parseJsonc(content)
		if (parsed === undefined) {
			log.error(`[worktree] Invalid worktree.jsonc syntax`)
			return worktreeConfigSchema.parse({})
		}
		const config = worktreeConfigSchema.parse(parsed)
		if (config.worktreePath) {
			config.worktreePath = resolveHomePath(config.worktreePath)
		}
		return config
	} catch (error) {
		log.warn(`[worktree] Failed to load config: ${error}`)
		return worktreeConfigSchema.parse({})
	}
}
