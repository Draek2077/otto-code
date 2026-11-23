import type { ReactNode } from "react";
import type { VisualizerPreferences } from "./preferences";
export interface VisualizerPipFrameProps {
  preferences: VisualizerPreferences;
  save(patch: Partial<VisualizerPreferences>): void;
  children: ReactNode;
  shown: boolean;
}
