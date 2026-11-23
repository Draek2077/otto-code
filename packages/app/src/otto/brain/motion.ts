export interface BrainMotionPolicy {
  active: boolean;
  animationsEnabled: boolean;
  reducedMotion: boolean;
}

export function isBrainMotionEnabled(policy: BrainMotionPolicy): boolean {
  return policy.active && policy.animationsEnabled && !policy.reducedMotion;
}
