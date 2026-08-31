import type { ExplorerTab } from "@/stores/explorer-tab-memory";
export const DEFAULT_IOS_KEYBOARD_INSET_MIN_HEIGHT = 120;

export function shouldUseCompactExplorerKeyboardPadding(input: {
  isGit: boolean;
  // Otto's explorer has a Search tab as well; the rule is the same for it as
  // for Files, so this takes the whole ExplorerTab union rather than a subset
  // that silently excludes one.
  explorerTab: ExplorerTab;
}): boolean {
  return !input.isGit || input.explorerTab !== "changes";
}

export function resolveKeyboardShift(input: {
  rawKeyboardHeight: number;
  keyboardProgress: number;
  bottomInset: number;
  isIos: boolean;
  iosMinHeight: number;
}): number {
  "worklet";

  if (!(input.keyboardProgress > 0) || !(input.rawKeyboardHeight > 0)) {
    return 0;
  }

  // iOS can report a small accessory/prediction bar height during touch focus.
  // Treat that as non-keyboard so layouts don't "bounce" while interacting.
  if (input.isIos && input.rawKeyboardHeight < input.iosMinHeight) {
    return 0;
  }

  return Math.max(0, input.rawKeyboardHeight - input.bottomInset);
}
