/**
 * Permission detection logic shared between main sessions and subagents.
 *
 * When a tool call stays pending for longer than PERMISSION_DETECT_MS without
 * any new file activity, it's likely waiting for user permission approval.
 */

import { AgentEvent, PendingToolCall } from './protocol'
import { PERMISSION_DETECT_MS } from './constants'

/** Minimal state needed for permission tracking (shared by WatchedSession and SubagentState) */
export interface PermissionState {
  permissionTimer: NodeJS.Timeout | null
  permissionEmitted: boolean
}

export interface PermissionDetectionDelegate {
  emit(event: AgentEvent, sessionId?: string): void
  elapsed(sessionId?: string): number
  getLastActivityTime(sessionId: string): number | undefined
}

/**
 * Cancels any pending permission timer, clears the permission state if it
 * was emitted, and (re)starts detection if pending tool calls need permission.
 */
export function handlePermissionDetection(
  delegate: PermissionDetectionDelegate,
  agentName: string,
  pendingToolCalls: Map<string, PendingToolCall>,
  permState: PermissionState,
  sessionId: string,
  sessionCompleted?: boolean,
  checkSessionActivity?: boolean,
): void {
  if (permState.permissionTimer) {
    clearTimeout(permState.permissionTimer)
    permState.permissionTimer = null
  }

  if (permState.permissionEmitted) {
    permState.permissionEmitted = false
    delegate.emit({
      time: delegate.elapsed(sessionId),
      type: 'agent_idle',
      payload: { name: agentName },
    }, sessionId)
  }

  const needsPermission = Array.from(pendingToolCalls.values())
    .some(tc => tc.name !== 'Agent' && tc.name !== 'Task')
  if (needsPermission) {
    const snapshotTime = Date.now()
    permState.permissionTimer = setTimeout(() => {
      if (permState.permissionEmitted || sessionCompleted) return
      // Re-check: only trigger if there are still non-Agent pending tools
      // that were pending before the timer started (not freshly added)
      const stillPending = Array.from(pendingToolCalls.values())
        .some(tc => tc.name !== 'Agent' && tc.name !== 'Task' && tc.startTime <= snapshotTime)
      if (!stillPending) return

      // For the orchestrator, check if any session file (main or subagent) has
      // been written to recently — if so, tools are running, not blocked on permission.
      // Skip this check for subagents: their permission state is independent.
      if (checkSessionActivity) {
        const lastActivity = delegate.getLastActivityTime(sessionId)
        if (lastActivity !== undefined) {
          const recentThreshold = Date.now() - PERMISSION_DETECT_MS
          if (lastActivity > recentThreshold) return
        }
      }

      permState.permissionEmitted = true
      delegate.emit({
        time: delegate.elapsed(sessionId),
        type: 'permission_requested',
        payload: {
          agent: agentName,
          message: 'Waiting for permission',
        },
      }, sessionId)
    }, PERMISSION_DETECT_MS)
  }
}
