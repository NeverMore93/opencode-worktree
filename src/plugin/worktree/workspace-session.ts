/**
 * Workspace-level session fork, reuse, stale detection, and headless helpers.
 *
 * Handles the session lifecycle for workspace orchestration:
 * - `/dev <name>` always forks exactly ONE workspace-level session (FR-013)
 * - Repeated `/dev` reuses an existing session if still valid (FR-014)
 * - Headless single-repo mode (US3) skips session fork entirely (FR-020)
 *
 * @module worktree/workspace-session
 */

import { type Result, Result as R } from "./git"
import type { OpencodeClient } from "../kdco-primitives"
import { logWarn } from "../kdco-primitives"

// =============================================================================
// TYPES
// =============================================================================

/** Whether the workspace session was newly forked or reused from a previous run. */
export type SessionDisposition = "forked" | "reused"

/** Binding returned after resolving or forking a workspace session. */
export interface WorkspaceSessionBinding {
	readonly sessionId: string
	readonly disposition: SessionDisposition
}

/** Result returned for headless single-repo creates (US3 — no session fork). */
export interface HeadlessCreateResult {
	readonly worktreePath: string
	readonly projectId: string
}

// =============================================================================
// SESSION VALIDATION
// =============================================================================

/**
 * Check if a session ID is still valid via the SDK.
 *
 * A session is valid when the SDK resolves it without error. Any SDK error
 * (not found, network failure, etc.) means the session is stale (FR-014).
 *
 * @param client - OpenCode SDK client
 * @param sessionId - Session ID to validate
 * @returns true if the SDK resolves the session, false otherwise
 */
async function isSessionValid(
	client: OpencodeClient,
	sessionId: string,
): Promise<boolean> {
	try {
		const response = await client.session.get({ path: { id: sessionId } })
		// Session exists if the SDK returns data with an ID
		return !!response.data?.id
	} catch {
		return false
	}
}

// =============================================================================
// SESSION RESOLUTION
// =============================================================================

/**
 * Resolve or fork a workspace session.
 *
 * If `storedSessionId` is provided and still valid via the SDK, reuse it.
 * Otherwise fork a new session from `parentSessionId`.
 *
 * This implements FR-013 (one workspace-level session) and FR-014 (stale
 * detection via SDK resolution).
 *
 * @param client - OpenCode SDK client
 * @param parentSessionId - Session to fork from (current caller's session)
 * @param projectId - Project ID for logging context
 * @param storedSessionId - Previously persisted session ID to try reusing
 * @returns Result with the session binding, or an error string on fork failure
 */
export async function resolveWorkspaceSession(
	client: OpencodeClient,
	parentSessionId: string,
	projectId: string,
	storedSessionId?: string,
): Promise<Result<WorkspaceSessionBinding, string>> {
	// Guard: Try to reuse stored session if provided
	if (storedSessionId) {
		const valid = await isSessionValid(client, storedSessionId)
		if (valid) {
			return R.ok({ sessionId: storedSessionId, disposition: "reused" })
		}
		logWarn(
			client,
			"workspace-session",
			`Stored session ${storedSessionId} is stale for project ${projectId}; forking new session`,
		)
	}

	// Happy path: Fork a new session from the parent
	try {
		const response = await client.session.fork({
			path: { id: parentSessionId },
			body: {},
		})
		const forkedSession = response.data
		if (!forkedSession?.id) {
			return R.err("Failed to fork workspace session: no session data returned")
		}
		return R.ok({ sessionId: forkedSession.id, disposition: "forked" })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return R.err(`Failed to fork workspace session: ${message}`)
	}
}

// =============================================================================
// HEADLESS HELPERS
// =============================================================================

/**
 * Build a headless create result (no session fork).
 *
 * Used for US3 (headless single-repo mode) where the caller only needs the
 * worktree path and project ID without a forked session (FR-020).
 *
 * @param worktreePath - Absolute path to the created worktree
 * @param projectId - Stable project identifier
 * @returns HeadlessCreateResult
 */
export function buildHeadlessResult(
	worktreePath: string,
	projectId: string,
): HeadlessCreateResult {
	return { worktreePath, projectId }
}
