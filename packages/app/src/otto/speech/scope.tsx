import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { AssistantSelectionCopySurface } from "@/assistant-selection-copy/surface";
const Context = createContext<{ serverId: string; agentId: string } | null>(null);
export const useSpeechScope = () => useContext(Context);
export function SpeechScope({
  serverId,
  agentId,
  children,
}: {
  serverId: string;
  agentId: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ serverId, agentId }), [serverId, agentId]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function SpeechSelectionSurface({
  serverId,
  agentId,
  style,
  children,
}: {
  serverId: string;
  agentId: string;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <SpeechScope serverId={serverId} agentId={agentId}>
      <AssistantSelectionCopySurface style={style}>{children}</AssistantSelectionCopySurface>
    </SpeechScope>
  );
}
