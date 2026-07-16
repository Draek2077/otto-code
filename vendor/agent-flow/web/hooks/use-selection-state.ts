import { useState, useCallback } from "react"
import type { Agent, ToolCallNode, Discovery } from "@/lib/agent-types"

export interface ToolDataSnapshot {
  id: string
  toolName: string
  state: 'running' | 'complete' | 'error'
  args: string
  result?: string
  tokenCost?: number
  inputData?: Record<string, unknown>
}

export interface DiscoveryDataSnapshot {
  id: string
  type: string
  label: string
  content: string
  agentId: string
}

export interface ContextMenuState {
  x: number
  y: number
  agentId?: string
}

export interface ScreenPos {
  x: number
  y: number
}

export function useSelectionState(deps: {
  agents: Map<string, Agent>
  toolCalls: Map<string, ToolCallNode>
  discoveries: Discovery[]
}) {
  const { agents, toolCalls, discoveries } = deps

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null)
  const [selectedAgentWorldPos, setSelectedAgentWorldPos] = useState<ScreenPos | null>(null)

  const [selectedToolCallId, setSelectedToolCallId] = useState<string | null>(null)
  const [selectedToolScreenPos, setSelectedToolScreenPos] = useState<ScreenPos | null>(null)
  const [selectedToolData, setSelectedToolData] = useState<ToolDataSnapshot | null>(null)

  const [selectedDiscoveryId, setSelectedDiscoveryId] = useState<string | null>(null)
  const [selectedDiscoveryScreenPos, setSelectedDiscoveryScreenPos] = useState<ScreenPos | null>(null)
  const [selectedDiscoveryData, setSelectedDiscoveryData] = useState<DiscoveryDataSnapshot | null>(null)

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const clearAgent = useCallback(() => {
    setSelectedAgentId(null)
    setSelectedAgentWorldPos(null)
  }, [])

  const clearTool = useCallback(() => {
    setSelectedToolCallId(null)
    setSelectedToolScreenPos(null)
    setSelectedToolData(null)
  }, [])

  const clearDiscovery = useCallback(() => {
    setSelectedDiscoveryId(null)
    setSelectedDiscoveryScreenPos(null)
    setSelectedDiscoveryData(null)
  }, [])

  const clearOtherSelections = useCallback((keep: 'agent' | 'tool' | 'discovery') => {
    if (keep !== 'agent') clearAgent()
    if (keep !== 'tool') clearTool()
    if (keep !== 'discovery') clearDiscovery()
    setContextMenu(null)
  }, [clearAgent, clearTool, clearDiscovery])

  const handleAgentClick = useCallback((agentId: string | null) => {
    setSelectedAgentId(agentId)
    clearOtherSelections('agent')
    // Store screen position for the detail card
    if (agentId) {
      const agent = agents.get(agentId)
      if (agent) {
        setSelectedAgentWorldPos({ x: agent.x, y: agent.y })
      }
    } else {
      setSelectedAgentWorldPos(null)
    }
  }, [agents, clearOtherSelections])

  const handleToolCallClick = useCallback((toolCallId: string | null) => {
    setSelectedToolCallId(toolCallId)
    if (toolCallId) {
      // Only cross-clear when making a positive selection
      clearOtherSelections('tool')
      const tool = toolCalls.get(toolCallId)
      if (tool) {
        setSelectedToolScreenPos({ x: tool.x, y: tool.y })
        // Snapshot data so popup persists after tool card fades
        setSelectedToolData({
          id: tool.id, toolName: tool.toolName, state: tool.state, args: tool.args,
          result: tool.result, tokenCost: tool.tokenCost, inputData: tool.inputData,
        })
      }
    } else {
      setSelectedToolScreenPos(null)
      setSelectedToolData(null)
    }
  }, [toolCalls, clearOtherSelections])

  const handleDiscoveryClick = useCallback((discoveryId: string | null) => {
    setSelectedDiscoveryId(discoveryId)
    if (discoveryId) {
      // Only cross-clear when making a positive selection
      clearOtherSelections('discovery')
      const disc = discoveries.find(d => d.id === discoveryId)
      if (disc) {
        setSelectedDiscoveryScreenPos({ x: disc.x, y: disc.y })
        // Snapshot data so popup persists after discovery card fades
        setSelectedDiscoveryData({
          id: disc.id, type: disc.type, label: disc.label, content: disc.content, agentId: disc.agentId,
        })
      }
    } else {
      setSelectedDiscoveryScreenPos(null)
      setSelectedDiscoveryData(null)
    }
  }, [discoveries, clearOtherSelections])

  const handleContextMenu = useCallback((e: React.MouseEvent, type: 'agent' | 'edge' | 'canvas', id?: string) => {
    if (type === 'agent' && id) {
      setContextMenu({ x: e.clientX, y: e.clientY, agentId: id })
    } else if (type === 'canvas') {
      setContextMenu({ x: e.clientX, y: e.clientY })
    } else {
      setContextMenu(null)
    }
  }, [])

  const clearAllSelections = useCallback(() => {
    clearAgent()
    clearTool()
    clearDiscovery()
    setContextMenu(null)
  }, [clearAgent, clearTool, clearDiscovery])

  return {
    selectedAgentId,
    hoveredAgentId,
    setHoveredAgentId,
    selectedAgentWorldPos,
    selectedToolCallId,
    selectedToolScreenPos,
    selectedToolData,
    selectedDiscoveryId,
    selectedDiscoveryScreenPos,
    selectedDiscoveryData,
    contextMenu,
    setContextMenu,
    handleAgentClick,
    handleToolCallClick,
    handleDiscoveryClick,
    handleContextMenu,
    clearAgent,
    clearTool,
    clearDiscovery,
    clearAllSelections,
  }
}
