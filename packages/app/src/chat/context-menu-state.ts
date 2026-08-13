export type ChatContextMenuOwner = "selection" | "target" | "chat";

/** The priority order for right-click ownership inside a chat transcript. */
export function resolveChatContextMenuOwner(input: {
  hasTextSelection: boolean;
  hasTarget: boolean;
}): ChatContextMenuOwner {
  if (input.hasTextSelection) {
    return "selection";
  }
  return input.hasTarget ? "target" : "chat";
}
