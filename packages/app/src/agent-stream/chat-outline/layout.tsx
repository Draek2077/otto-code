import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface ChatOutlineLayoutState {
  isRailVisible: boolean;
  setRailVisible: (visible: boolean) => void;
}

const NOOP = () => undefined;
const ChatOutlineLayoutContext = createContext<ChatOutlineLayoutState>({
  isRailVisible: false,
  setRailVisible: NOOP,
});

/**
 * Keeps the outline rail and the otherwise independent chat tracks on one
 * layout contract. The rail alone knows when it can render in this pane; every
 * ChatWidthBounds descendant follows that result.
 */
export function ChatOutlineLayoutProvider({
  enabled,
  initiallyReserveGutter = enabled,
  children,
}: {
  enabled: boolean;
  /**
   * Existing agents reserve the rail's clearance until history determines
   * whether it can render. A brand-new draft has no history or rail yet, so
   * reserving that space makes its composer visibly resize on first send.
   */
  initiallyReserveGutter?: boolean;
  children: ReactNode;
}) {
  // Existing chats reserve the gutter before their initial timeline response
  // arrives. The rail later withdraws it for chats with fewer than two prompts
  // or a narrow pane, but a chat that will show the rail never visibly reflows.
  const [railVisible, setRailVisible] = useState(initiallyReserveGutter);

  useEffect(() => {
    if (!enabled) {
      setRailVisible(false);
    }
  }, [enabled]);

  const value = useMemo(
    () => ({
      isRailVisible: enabled && railVisible,
      setRailVisible,
    }),
    [enabled, railVisible],
  );

  return <ChatOutlineLayoutContext value={value}>{children}</ChatOutlineLayoutContext>;
}

export function useChatOutlineLayout(): ChatOutlineLayoutState {
  return useContext(ChatOutlineLayoutContext);
}
