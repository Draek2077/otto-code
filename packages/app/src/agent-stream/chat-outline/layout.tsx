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
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [railVisible, setRailVisible] = useState(false);

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
