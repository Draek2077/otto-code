import { type PropsWithChildren } from "react";

/** Native platforms retain their OS text-selection controls. */
export function TextSelectionMenuProvider({ children }: PropsWithChildren) {
  return children;
}

export function TextSelectionMenuHybridScope({ children }: PropsWithChildren) {
  return children;
}
