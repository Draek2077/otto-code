// TypeScript resolves this base module while Metro selects the platform file.
export {
  TextSelectionMenuProvider,
  TextSelectionMenuHybridScope,
  TextSelectionActionsScope,
  useTextSelectionContextMenu,
  type OpenTextSelectionMenuOptions,
  type TextSelectionActionsContext,
  type TextSelectionActionsResolver,
} from "./text-selection-menu.web";
