import type { ReactNode } from "react";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
export interface WorkspaceEditorDropsProps {
  children: ReactNode;
  serverId: string;
  workspaceId: string;
  active: boolean;
  openFile(location: WorkspaceFileLocation): void;
}
// Native uses its existing file picker/share flows; no browser globals or drop interception.
export function WorkspaceEditorDrops({ children }: WorkspaceEditorDropsProps) {
  return children;
}
