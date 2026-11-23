import type { ReactNode } from "react";
export interface VisualizerBackgroundProps {
  serverId: string;
  workspaceId: string;
  agentId: string | null;
  children: ReactNode;
  enabled?: boolean;
}
