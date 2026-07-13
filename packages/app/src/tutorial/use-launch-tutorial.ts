import { useEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { useAppSettings } from "@/hooks/use-settings";
import { useHosts } from "@/runtime/host-runtime";
import { useTutorialStore } from "./store";

// The home route the first-run tour launches from. Kept literal (not a builder
// call) so this stays a cheap string compare each render.
const HOME_PATHNAME = "/open-project";

// Auto-starts the tour once, the first time a fresh-install device reaches home
// with a connected host. This is the fallback for users who bypass the
// first-time wizard; when the wizard ships, its final step calls
// useTutorialStore.getState().start() directly (take the tour) or persists
// hasCompletedTutorial (skip). Gating on a connected host + the home route also
// keeps it from firing during pairing or the wizard.
export function useLaunchTutorial(): void {
  const { settings, isLoading } = useAppSettings();
  const pathname = usePathname();
  const hosts = useHosts();
  const startedRef = useRef(false);

  const hasCompleted = settings.hasCompletedTutorial;
  const atHome = pathname === HOME_PATHNAME;
  const hasHost = hosts.length > 0;

  useEffect(() => {
    // The in-app tutorial is disabled for now (not ready). Keep the gating logic
    // below for when it returns, but never auto-start it. To re-enable, drop this
    // early return.
    const TUTORIAL_ENABLED = false;
    if (!TUTORIAL_ENABLED) {
      return;
    }
    if (startedRef.current) {
      return;
    }
    if (isLoading || hasCompleted || !atHome || !hasHost) {
      return;
    }
    startedRef.current = true;
    useTutorialStore.getState().start();
  }, [isLoading, hasCompleted, atHome, hasHost]);
}
