import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";

/**
 * Communications deliberately route only text sending and dictation through
 * the shared MessageInput shortcut surface. Agent interruption and realtime
 * voice controls have no room equivalent.
 */
export function resolveNonAgentMessageInputKeyboardAction(
  actionId: string,
): MessageInputKeyboardActionKind | null {
  switch (actionId) {
    case "message-input.send":
      return "send";
    case "message-input.dictation-toggle":
      return "dictation-toggle";
    case "message-input.dictation-cancel":
      return "dictation-cancel";
    case "message-input.dictation-confirm":
      return "dictation-confirm";
    default:
      return null;
  }
}
