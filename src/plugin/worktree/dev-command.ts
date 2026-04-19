/**
 * FR-024: Auto-create `.opencode/commands/dev.md` so users can invoke
 * `/dev <name>` as the slash-command equivalent of the
 * `worktree_workspace_create` AI tool.
 *
 * OpenCode discovers custom slash commands by scanning
 * `{command,commands}/**​/*.md` (see `config/command.ts:29` in the OpenCode
 * source). The markdown body becomes a prompt sent to the LLM with
 * `$ARGUMENTS` substituted (`session/prompt.ts:1577-1578`). Plugin-registered
 * tools — including `worktree_workspace_create` — are available to the LLM
 * because command execution flows through the standard `prompt(...)` path
 * (`session/prompt.ts:1646`).
 *
 * Auto-create here mirrors the pattern used by `loadWorktreeConfig`:
 * idempotent (only writes when absent), resilient (failure logged, never
 * crashes plugin startup), and runs once per plugin activation alongside
 * the existing `.opencode/worktree.jsonc` bootstrap.
 */

import { mkdir } from "node:fs/promises"
import * as path from "node:path"
import type { Logger } from "./config"

/**
 * Template body written to `.opencode/commands/dev.md` on first activation.
 *
 * The frontmatter `description` is what users see in OpenCode's command
 * picker / `/help`. The body is a single instruction telling the LLM to
 * call our `worktree_workspace_create` tool with the user's argument.
 */
const DEV_COMMAND_TEMPLATE = `---
description: Create or reconcile a multi-repo workspace under <cwd>/../worktrees/<name>/
---
Use the worktree_workspace_create tool with name="$ARGUMENTS" to set up a multi-repo workspace.
`

/**
 * Idempotently create `<directory>/.opencode/commands/dev.md`.
 *
 * - If the file already exists (any content), it is left untouched. This
 *   honours user customisation — once they edit `dev.md`, our defaults must
 *   never overwrite it.
 * - If the parent `.opencode/commands/` directory is missing, it is created
 *   with `recursive: true`.
 * - Any I/O failure is logged at warn level. Plugin startup proceeds normally
 *   so a transient FS error never breaks the rest of the plugin.
 *
 * @param directory  Plugin's project directory (`ctx.directory` from
 *                   `WorktreePlugin`). The slash command file is written
 *                   relative to this so OpenCode's per-project config scan
 *                   picks it up.
 * @param log        Logger from the plugin entry. Used to record creation
 *                   and any non-fatal write failure.
 */
export async function ensureDevCommand(directory: string, log: Logger): Promise<void> {
	const commandPath = path.join(directory, ".opencode", "commands", "dev.md")
	try {
		const file = Bun.file(commandPath)
		if (await file.exists()) return
		await mkdir(path.dirname(commandPath), { recursive: true })
		await Bun.write(commandPath, DEV_COMMAND_TEMPLATE)
		log.info(`[worktree] Created /dev slash command: ${commandPath}`)
	} catch (error) {
		log.warn(`[worktree] Failed to create /dev slash command at ${commandPath}: ${error}`)
	}
}
