export type TextSelectionMenuActionId = "cut" | "copy" | "paste" | "selectAll";

export interface TextSelectionMenuCapabilities {
  editable: boolean;
  hasSelection: boolean;
  canSelectAll: boolean;
}

export interface TextSelectionMenuAction {
  id: TextSelectionMenuActionId;
  enabled: boolean;
}

/**
 * The familiar edit-menu vocabulary, independent of where the text came from.
 * Static text deliberately does not advertise Cut or Paste: those actions have
 * no meaningful target there, while an editable control gets the complete set.
 */
export function resolveTextSelectionMenuActions(
  capabilities: TextSelectionMenuCapabilities,
): readonly TextSelectionMenuAction[] {
  if (capabilities.editable) {
    return [
      { id: "cut", enabled: capabilities.hasSelection },
      { id: "copy", enabled: capabilities.hasSelection },
      { id: "paste", enabled: true },
      { id: "selectAll", enabled: capabilities.canSelectAll },
    ];
  }

  return [
    { id: "copy", enabled: capabilities.hasSelection },
    { id: "selectAll", enabled: capabilities.canSelectAll },
  ];
}
