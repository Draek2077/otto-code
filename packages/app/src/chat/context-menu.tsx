import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useImperativeHandle,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { isNative } from "@/constants/platform";
import {
  ContextMenu,
  ContextMenuContent,
  contextMenuAnchorFromEvent,
  hasWebTextSelection,
} from "@/components/ui/context-menu";
import { resolveChatContextMenuOwner } from "./context-menu-state";

interface ChatContextMenuTargetContextValue {
  /** Opens the chat-owned menu with actions contributed by the clicked target. */
  openTarget: (event: unknown, content: ReactNode) => boolean;
}

export interface ChatContextMenuHandle {
  close: () => void;
}

const ChatContextMenuTargetContext = createContext<ChatContextMenuTargetContextValue | null>(null);

/**
 * Lets a transcript element replace the background actions with its own
 * contextual actions. Text selection still wins, preserving platform copy and
 * accessibility behavior.
 */
export function useChatContextMenuTarget(): ChatContextMenuTargetContextValue | null {
  return useContext(ChatContextMenuTargetContext);
}

interface ChatContextMenuProps {
  fallbackContent: ReactNode;
  testID?: string;
}

/**
 * The one context-menu presentation for a chat transcript. Individual
 * transcript elements contribute content through `useChatContextMenuTarget`;
 * the supplied fallback remains the menu for unclaimed chat background.
 */
export const ChatContextMenu = forwardRef<
  ChatContextMenuHandle,
  PropsWithChildren<ChatContextMenuProps>
>(function ChatContextMenu({ children, fallbackContent, testID }, ref) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [targetContent, setTargetContent] = useState<ReactNode | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setAnchor(null);
    setTargetContent(null);
  }, []);
  useImperativeHandle(ref, () => ({ close }), [close]);

  const openTarget = useCallback((event: unknown, content: ReactNode): boolean => {
    if (
      resolveChatContextMenuOwner({ hasTextSelection: hasWebTextSelection(), hasTarget: true }) ===
      "selection"
    ) {
      return false;
    }
    const nextAnchor = contextMenuAnchorFromEvent(event);
    if (!nextAnchor) {
      return false;
    }
    setTargetContent(content);
    setAnchor(nextAnchor);
    setOpen(true);
    return true;
  }, []);
  const handleBackgroundContextMenu = useCallback(
    (event: unknown) => {
      openTarget(event, fallbackContent);
    },
    [fallbackContent, openTarget],
  );
  const contextValue = useMemo(() => ({ openTarget }), [openTarget]);
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setAnchor(null);
      setTargetContent(null);
    }
  }, []);

  return (
    <ChatContextMenuTargetContext.Provider value={contextValue}>
      <ContextMenu anchor={anchor} open={open} onOpenChange={handleOpenChange}>
        <View
          testID={testID}
          // @ts-expect-error - onContextMenu is web-only and not in RN types.
          onContextMenu={isNative ? undefined : handleBackgroundContextMenu}
        >
          {children}
        </View>
        <ContextMenuContent side="bottom" align="start" testID="agent-chat-context-menu">
          {targetContent ?? fallbackContent}
        </ContextMenuContent>
      </ContextMenu>
    </ChatContextMenuTargetContext.Provider>
  );
});
