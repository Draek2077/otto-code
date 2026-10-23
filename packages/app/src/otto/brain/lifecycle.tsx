import { createContext, useContext, type ReactNode } from "react";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { isBrainMotionEnabled, type BrainMotionPolicy } from "./motion";

const BrainActiveContext = createContext(false);
const BrainMotionContext = createContext(false);

export interface BrainLifecycleProps extends BrainMotionPolicy {
  children: ReactNode;
}

/** The owner supplies app/system preferences and visibility; retained ancestors also gate work. */
export function BrainLifecycleProvider({
  active,
  animationsEnabled,
  reducedMotion,
  children,
}: BrainLifecycleProps) {
  const retainedActive = useRetainedPanelActive();
  const parentActive = useContext(BrainActiveContext);
  const parentMotion = useContext(BrainMotionContext);
  const surfaceActive = active && retainedActive;
  const motionEnabled = isBrainMotionEnabled({
    active: surfaceActive,
    animationsEnabled,
    reducedMotion,
  });
  // Nested Brain boundaries can restrict their parent, never reactivate it.
  const hasParent = useContext(BrainBoundaryContext);
  const effectiveActive = surfaceActive && (!hasParent || parentActive);
  const effectiveMotion = motionEnabled && (!hasParent || parentMotion);
  return (
    <BrainBoundaryContext value={true}>
      <BrainActiveContext value={effectiveActive}>
        <BrainMotionContext value={effectiveMotion}>{children}</BrainMotionContext>
      </BrainActiveContext>
    </BrainBoundaryContext>
  );
}

const BrainBoundaryContext = createContext(false);

export function useBrainSurfaceActive(): boolean {
  return useContext(BrainActiveContext);
}

export function useBrainMotionEnabled(): boolean {
  return useContext(BrainMotionContext);
}
