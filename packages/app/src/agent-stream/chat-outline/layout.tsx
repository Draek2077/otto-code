import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

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
 * layout contract. The rail is the only writer: it decides the gutter from the
 * prompt index and the pane width, and every ChatWidthBounds descendant follows.
 *
 * There is no optimistic reservation. A chat opens with no gutter and gains one
 * only once the rail knows it will render, before that frame paints. On first
 * load the history overlay hides the chat until the timeline, and the prompt
 * index that rides with it, has arrived, so the gutter never visibly changes
 * while loading. It changes only when the prompt count crosses the threshold,
 * the pane crosses the width threshold, or the preference is toggled.
 */
export function ChatOutlineLayoutProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [railVisible, setRailVisible] = useState(false);

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
