import type { RefObject } from "react";
import type { View } from "react-native";

export interface ChatBackgroundPointerOptions {
  rootRef: RefObject<View | null>;
  foregroundRef: RefObject<View | null>;
  enabled: boolean;
  hidden: boolean;
  onPeek: (peek: boolean) => void;
  onToggle: () => void;
  onRestore: () => void;
}

// Touch platforms expose the same show/hide action through the fixed control.
export function useChatBackgroundPointer(_options: ChatBackgroundPointerOptions): void {}
