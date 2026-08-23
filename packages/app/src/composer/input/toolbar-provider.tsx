import type { ReactNode } from "react";
import type { ComposerControlStage } from "@/composer/agent-controls/layout";
import {
  ComposerToolbarFeatureFitContext,
  ComposerToolbarStageContext,
} from "./toolbar-width-context";

/**
 * Publishes what the composer row measured to the controls inside it: whether
 * the compact features button fits, and the stage that says how much text each
 * control may still render. Both are answers only the row can compute, and both
 * are deliberately coarse - they change a handful of times across a resize
 * rather than every frame.
 */
export function ComposerToolbarProvider({
  canFitFeatures,
  stage,
  children,
}: {
  canFitFeatures: boolean;
  stage: ComposerControlStage;
  children: ReactNode;
}) {
  return (
    <ComposerToolbarFeatureFitContext.Provider value={canFitFeatures}>
      <ComposerToolbarStageContext.Provider value={stage}>
        {children}
      </ComposerToolbarStageContext.Provider>
    </ComposerToolbarFeatureFitContext.Provider>
  );
}
