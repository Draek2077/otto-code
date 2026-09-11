import type { ReactNode } from "react";

export interface WindowOverlayProps {
  children: ReactNode;
  layer?: number;
}

export interface PaneOverlayProps extends WindowOverlayProps {
  pointerEvents?: "auto" | "none";
  clip?: boolean;
}

export function PaneOverlay({ children }: PaneOverlayProps) {
  return children;
}

export function WindowOverlay({ children }: WindowOverlayProps) {
  return children;
}
