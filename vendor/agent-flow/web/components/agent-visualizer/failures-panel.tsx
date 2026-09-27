'use client'

import type { FailedToolCall } from '@/lib/agent-types'
import { Z } from '@/lib/agent-types'
import { COLORS, withAlpha } from '@/lib/colors'
import { formatTokens } from '@/lib/utils'
import { PanelHeader, SlidingPanel } from './shared-ui'

interface FailuresPanelProps {
  visible: boolean
  failures: Map<string, FailedToolCall>
}

/** OTTO PATCH (OTTO-PATCHES.md): persistent inspection for failed tool calls.
 * The canvas intentionally retires finished tool cards, so this panel reads
 * the simulation's bounded failure record rather than the live tool map. */
export function FailuresPanel({ visible, failures }: FailuresPanelProps) {
  if (!visible) return null
  const rows = Array.from(failures.values()).reverse()

  return (
    <SlidingPanel visible={visible} position={{ top: 42, right: 12 }} zIndex={Z.sidePanel} width={300}>
      <div className="glass-card relative">
        <PanelHeader>
          <span className="text-[10px] font-mono tracking-wider" style={{ color: COLORS.textPrimary }}>
            Failed Tool Calls
          </span>
          <span className="text-[9px] font-mono" style={{ color: COLORS.error }}>
            {rows.length}
          </span>
        </PanelHeader>
        <div className="space-y-1 max-h-[360px] overflow-y-auto">
          {rows.length === 0 && (
            <div className="text-[9px] font-mono py-2 text-center" style={{ color: COLORS.textMuted }}>
              No failed tool calls in this view
            </div>
          )}
          {rows.map(failure => (
            <div
              key={failure.id}
              className="rounded px-2 py-1.5"
              style={{ background: withAlpha(COLORS.toolCardBase, 0.5), border: `1px solid ${COLORS.error}30` }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono truncate" style={{ color: COLORS.error }} title={failure.toolName}>
                  {failure.toolName}
                </span>
                {failure.retries > 0 && (
                  <span className="text-[9px] font-mono whitespace-nowrap" style={{ color: COLORS.textMuted }}>
                    {failure.retries} later attempt{failure.retries === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <div className="text-[9px] font-mono truncate" style={{ color: COLORS.textMuted }} title={failure.agentId}>
                {failure.agentId}
              </div>
              {failure.args && (
                <div className="otto-code text-[9px] truncate" style={{ color: COLORS.textPrimary }} title={failure.args}>
                  {failure.args}
                </div>
              )}
              <details className="text-[9px] leading-snug mt-1 break-words" style={{ color: COLORS.error }}>
                <summary className="cursor-pointer">{failure.errorMessage.split('\n')[0]}</summary>
                <div className="otto-code mt-1 whitespace-pre-wrap" style={{ color: COLORS.textPrimary }}>
                  {failure.errorMessage}
                </div>
              </details>
              {failure.tokenCost != null && failure.tokenCost > 0 && (
                <div className="text-[9px] font-mono mt-1" style={{ color: COLORS.textMuted }}>
                  ~{formatTokens(failure.tokenCost)} result tokens
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </SlidingPanel>
  )
}
