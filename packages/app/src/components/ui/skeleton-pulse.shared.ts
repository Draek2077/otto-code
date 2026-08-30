// Timing and opacity for the loading-skeleton shimmer, shared so the native
// Animated interpolation and the web CSS keyframe are literally the same
// numbers. See skeleton-pulse.tsx (native) and skeleton-pulse.web.tsx (web).

import type { Animated } from "react-native";

/**
 * Opaque pulse clock returned by `useSkeletonPulse`, created once per skeleton
 * and passed to every `SkeletonPulse` leaf.
 *
 * The Animations setting is read here, once per skeleton, rather than in the
 * leaves: a skeleton fans out to dozens of leaves, and `useAppSettings` is a
 * bare query subscription that re-renders its consumer on every settings write.
 */
export interface SkeletonPulseDriver {
  /** When false the placeholder renders static, at the resting opacity. */
  readonly animated: boolean;
  /**
   * Native clock shared by every leaf so they pulse in phase off one loop.
   * Null on web, where a CSS keyframe drives the pulse and there is no JS clock.
   */
  readonly value: Animated.Value | null;
}

/** Bottom of the pulse, and the resting opacity when animations are switched off. */
export const SKELETON_PULSE_MIN_OPACITY = 0.4;

/** Top of the pulse. */
export const SKELETON_PULSE_MAX_OPACITY = 0.8;

/** Half a cycle (min to max). A full round trip is twice this. */
export const SKELETON_PULSE_HALF_CYCLE_MS = 1000;
