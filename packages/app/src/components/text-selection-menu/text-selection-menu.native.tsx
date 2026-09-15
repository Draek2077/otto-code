import { type PropsWithChildren } from "react";
import type { TextSelectionActionsResolver } from "./text-selection-menu.web";

/** Native platforms retain their OS text-selection controls. */
export function TextSelectionMenuProvider({ children }: PropsWithChildren) {
  return children;
}

export function TextSelectionMenuHybridScope({ children }: PropsWithChildren) {
  return children;
}

export function TextSelectionActionsScope({
  children,
}: PropsWithChildren<{ resolve: TextSelectionActionsResolver }>) {
  return children;
}
