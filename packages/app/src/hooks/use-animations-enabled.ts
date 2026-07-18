import { useAppSettings } from "@/hooks/use-settings";

/**
 * Device-local master switch for the app's chrome motion — page-transition
 * cross-fades and desktop sidebar slides (Appearance → Animations). Defaults on;
 * off restores the instant, no-animation behavior. Read this everywhere a motion
 * decision is made rather than reaching into `settings.animationsEnabled`
 * directly, so the gate stays greppable and consistent.
 */
export function useAnimationsEnabled(): boolean {
  return useAppSettings().settings.animationsEnabled;
}
