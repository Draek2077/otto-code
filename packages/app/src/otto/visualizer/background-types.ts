import type { ReactNode } from "react";
export interface VisualizerBackgroundProps {
  serverId: string;
  workspaceId: string;
  agentId: string;
  children: ReactNode;
  enabled?: boolean;
}
