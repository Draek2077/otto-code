import { useCallback } from "react";
import type { RefObject } from "react";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { focusWithRetries } from "@/utils/web-focus";
import { isNative } from "@/constants/platform";
import type { MessageInputRef } from "./input/input";
import { resolveNonAgentMessageInputKeyboardAction } from "./message-input-keyboard-actions";

function resolveKeyboardPriority(isMessageInputFocused: boolean): number {
  return isMessageInputFocused ? 200 : 100;
}

/** Keeps browser focus reliable after a pane or room becomes active. */
export function focusMessageInputWithPlatformStrategy(
  messageInputRef: RefObject<MessageInputRef | null>,
): void {
  if (isNative) {
    messageInputRef.current?.focus();
    return;
  }
  focusWithRetries({
    focus: () => messageInputRef.current?.focus(),
    isFocused: () => {
      const element = messageInputRef.current?.getNativeElement?.() ?? null;
      return Boolean(element) && document.activeElement === element;
    },
  });
}

interface UseMessageInputKeyboardScopeArgs {
  handlerId: string;
  isPaneFocused: boolean;
  isMessageInputFocused: boolean;
  messageInputRef: RefObject<MessageInputRef | null>;
}

/**
 * Non-agent keyboard behaviour shared by room and agent composers. Agent
 * interruption remains deliberately outside this scope because a room has no
 * agent lifecycle to interrupt.
 */
export function useMessageInputKeyboardScope({
  handlerId,
  isPaneFocused,
  isMessageInputFocused,
  messageInputRef,
}: UseMessageInputKeyboardScopeArgs): void {
  const handleKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (!isPaneFocused) return false;
      if (action.id === "message-input.focus") {
        focusMessageInputWithPlatformStrategy(messageInputRef);
        return true;
      }
      const messageInputAction = resolveNonAgentMessageInputKeyboardAction(action.id);
      if (!messageInputAction) return false;
      return messageInputRef.current?.runKeyboardAction(messageInputAction) ?? false;
    },
    [isPaneFocused, messageInputRef],
  );

  useKeyboardActionHandler({
    handlerId,
    actions: [
      "message-input.focus",
      "message-input.send",
      "message-input.dictation-toggle",
      "message-input.dictation-cancel",
      "message-input.dictation-confirm",
    ],
    enabled: isPaneFocused,
    priority: resolveKeyboardPriority(isMessageInputFocused),
    isActive: () => isPaneFocused,
    handle: handleKeyboardAction,
  });
}
