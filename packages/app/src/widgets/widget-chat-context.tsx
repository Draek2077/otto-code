import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Which chat a widget belongs to.
 *
 * Provided once by the agent-stream view, which already knows both ids, rather
 * than threaded as props through `ToolCall` — that component is rendered from
 * four call sites and none of the others has any use for them.
 *
 * It is also the active-chat gate in practice: `sendPrompt` resolves its target
 * from here, so a widget with no provider above it (a detached preview, a
 * fixture, a surface that is not a live conversation) can look but not type.
 */
export interface WidgetChatTarget {
  serverId: string | undefined;
  agentId: string | undefined;
}

const WidgetChatContext = createContext<WidgetChatTarget>({
  serverId: undefined,
  agentId: undefined,
});

export function WidgetChatProvider({
  serverId,
  agentId,
  children,
}: WidgetChatTarget & { children: ReactNode }) {
  const value = useMemo(() => ({ serverId, agentId }), [serverId, agentId]);
  return <WidgetChatContext.Provider value={value}>{children}</WidgetChatContext.Provider>;
}

export function useWidgetChatTarget(): WidgetChatTarget {
  return useContext(WidgetChatContext);
}
