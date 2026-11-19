import type { ReactNode } from "react";

export function WorkspaceTabDragLayer({ children }: { active: boolean; children: ReactNode }) {
  return children;
}

export function WorkspaceTabDropLayer({ children }: { children: ReactNode }) {
  return children;
}
