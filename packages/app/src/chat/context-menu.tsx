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
import { StyleSheet } from "react-native-unistyles";
import { isNative } from "@/constants/platform";
import {
  ContextMenu,
  ContextMenuContent,
  contextMenuAnchorFromEvent,
  hasWebTextSelection,
} from "@/components/ui/context-menu";
import { ChatContextMenuContentBoundary } from "./context-menu-content-boundary";
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
  // Identifies one opening of the menu, so the content boundary forgets a
  // caught error as soon as a different menu is opened.
  const [contentRevision, setContentRevision] = useState(0);

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
    setContentRevision((revision) => revision + 1);
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
          // The transcript below this is a bounded scroll region, so this
          // wrapper has to pass the parent's height straight through. Without
          // `flex: 1` it sizes to its content, the scroll container grows to
          // the full transcript height, and nothing can ever overflow: the
          // chat renders but cannot be scrolled and "scroll to bottom" is a
          // no-op. The element it replaced carried this flex itself.
          style={styles.fill}
          testID={testID}
          // @ts-expect-error - onContextMenu is web-only and not in RN types.
          onContextMenu={isNative ? undefined : handleBackgroundContextMenu}
        >
          {children}
        </View>
        <ContextMenuContent side="bottom" align="start" testID="agent-chat-context-menu">
          {/* Content that cannot render has no actions to offer, so a caught
              failure closes the menu rather than pinning an empty surface open. */}
          <ChatContextMenuContentBoundary onError={close} resetKey={contentRevision}>
            {targetContent ?? fallbackContent}
          </ChatContextMenuContentBoundary>
        </ContextMenuContent>
      </ContextMenu>
    </ChatContextMenuTargetContext.Provider>
  );
});

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
