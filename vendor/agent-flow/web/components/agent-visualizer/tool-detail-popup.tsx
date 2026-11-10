'use client'

import { POPUP } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { ToolContentRenderer } from './tool-content-renderer'
import { PanelHeader, DetailPopup } from './shared-ui'

interface ToolDetailPopupProps {
  tool: {
    id: string
    toolName: string
    state: 'running' | 'complete' | 'error'
    args: string
    result?: string
    tokenCost?: number
    inputData?: Record<string, unknown>
  }
  position: { x: number; y: number }
  onClose: () => void
}

export function ToolDetailPopup({ tool, position, onClose }: ToolDetailPopupProps) {
  const stateColor = tool.state === 'running' ? COLORS.tool_calling : COLORS.complete

  return (
    <DetailPopup position={position} width={POPUP.tool.width} estimatedHeight={POPUP.tool.estimatedHeight} onClose={onClose}>
      <PanelHeader onClose={onClose}>
        <span className="text-[9px]" style={{ color: stateColor }}>
          {tool.state === 'running' ? '⚙' : '✓'}
        </span>
        <span className="text-[11px] font-mono font-semibold" style={{ color: COLORS.tool_calling }}>
          {tool.toolName}
        </span>
        <span className="text-[9px] font-mono capitalize" style={{ color: stateColor + '90' }}>
          {tool.state}
        </span>
      </PanelHeader>

      {/* Rich content */}
      {tool.inputData ? (
        <ToolContentRenderer
          toolName={tool.toolName}
          inputData={tool.inputData}
          args={tool.args}
          compact={false}
        />
      ) : (
        <div className="text-[10px] font-mono" style={{ color: COLORS.textPrimary + '90' }}>
          {tool.args}
        </div>
      )}

      {/* Result */}
      {tool.result && (
        <div
          className="mt-2 rounded px-2 py-1 text-[9px] font-mono"
          style={{
            background: COLORS.resultBg,
            border: `1px solid ${COLORS.resultBorder}`,
            color: COLORS.complete + '90',
          }}
        >
          <span className="opacity-50 mr-1">Result:</span>
          {tool.result}
        </div>
      )}

      {/* Token cost */}
      {tool.tokenCost != null && tool.tokenCost > 0 && (
        <div className="mt-1.5 text-[9px] font-mono" style={{ color: COLORS.textMuted }}>
          {tool.tokenCost} tokens
        </div>
      )}
    </DetailPopup>
  )
}
