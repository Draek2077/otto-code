// Mount point + lazy boundary for the picture-in-picture Visualizer.
//
// This module is imported eagerly by the workspace screen, so it must stay
// light: `visualizer-pip.tsx` transitively pulls the vendored render layer, and
// Metro does not tree-shake (docs/feature-flags.md), so the only way a disabled
// Visualizer genuinely costs nothing is a React.lazy split. Same boundary
// visualizer-panel-registration.tsx draws for the tab.
//
// It also owns the mutual exclusion that makes the "one canvas" decision real:
// PIP renders only when no Visualizer TAB exists in this workspace. Both
// surfaces host their own guest, so letting them coexist would mean two
// simulations and two star fields — exactly the doubled per-frame cost the
// charter warns about.
//
// The render gate below keeps that guarantee frame-tight, but it is NOT what
// enforces the invariant: `useReconcileVisualizerSurface` writes the setting
// back to false so the closed state is real rather than merely hidden. Parking
// PIP silently is what made its old header button dead chrome — see the bug note
// in use-visualizer-surface.ts.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { VISUALIZER_PIP_FADE_DURATION_MS } from "@/constants/animation";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFeatureEnabled } from "@/features/use-feature-enabled";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";
import { useAppSettings } from "@/hooks/use-settings";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useReconcileVisualizerSurface } from "@/visualizer/use-visualizer-surface";
import { useWorkspaceTabsFromLayout } from "@/visualizer/use-workspace-chat-focus";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";

const VisualizerPipLazy = lazy(async () => {
  const module = await import("@/visualizer/visualizer-pip");
  return { default: module.VisualizerPip };
});

export interface VisualizerPipHostProps {
  serverId: string;
  /** Empty before the route has resolved a workspace — the host renders nothing
   * rather than making every call site guard. */
  workspaceId: string;
  /** The workspace route is on screen. */
  isVisible: boolean;
  onOpenFile: (request: WorkspaceFileOpenRequest) => void;
}

export function VisualizerPipHost({
  serverId,
  workspaceId,
  isVisible,
  onOpenFile,
}: VisualizerPipHostProps) {
  const visualizerEnabled = useFeatureEnabled("visualizer");
  // Never on mobile. Not "degraded on mobile" — absent. A floating viewport you
  // drag around makes no sense on a single-pane phone layout, where the chat
  // already owns the whole screen and there is nothing to float over. Crossing
  // the breakpoint (resizing the window, rotating a tablet) unmounts it live;
  // the setting is untouched, so it returns when you cross back. The Visualizer
  // button still opens the normal full tab, which is the mobile answer.
  const isCompact = useIsCompactFormFactor();
  const { settings } = useAppSettings();

  const tabPersistenceKey = useMemo(
    () => buildWorkspaceTabPersistenceKey({ serverId, workspaceId }),
    [serverId, workspaceId],
  );
  // Layout store, not the tabs store — see use-workspace-chat-focus.ts for why
  // the latter is dead state.
  const workspaceTabs = useWorkspaceTabsFromLayout(tabPersistenceKey);
  const hasVisualizerTab = workspaceTabs.some((tab) => tab.target.kind === "visualizer");
  useReconcileVisualizerSurface(hasVisualizerTab);

  const shown = !(
    isCompact ||
    !workspaceId ||
    !visualizerEnabled ||
    !settings.visualizerPipOpen ||
    hasVisualizerTab
  );
  // With motion on, the PIP fades rather than vanishing — which means staying
  // mounted for the length of that fade after it should be gone. The overlap
  // with an expanding tab is bounded by the fade duration and the outgoing guest
  // is on its way out, so the one-canvas rule still holds in practice.
  const animationsEnabled = useAnimationsEnabled();
  const mounted = useFadeOutHold(shown, animationsEnabled ? VISUALIZER_PIP_FADE_DURATION_MS : 0);

  if (!mounted) {
    return null;
  }

  return (
    // No fallback: PIP is ambient chrome over the conversation, so a spinner
    // parked in the corner while the bundle loads would be noise. It simply
    // appears once it's ready.
    <Suspense fallback={null}>
      <VisualizerPipLazy
        serverId={serverId}
        workspaceId={workspaceId}
        isVisible={isVisible}
        shown={shown}
        onOpenFile={onOpenFile}
      />
    </Suspense>
  );
}

/** True while `shown` is true, and for `holdMs` after it goes false — long
 * enough for the exit fade to finish before the subtree is torn down. A hold of
 * 0 (Animations off) unmounts on the same commit, as it always did. */
function useFadeOutHold(shown: boolean, holdMs: number): boolean {
  const [held, setHeld] = useState(shown);

  useEffect(() => {
    if (shown) {
      setHeld(true);
      return;
    }
    if (holdMs <= 0) {
      setHeld(false);
      return;
    }
    const timer = setTimeout(() => setHeld(false), holdMs);
    return () => clearTimeout(timer);
  }, [shown, holdMs]);

  return shown || held;
}
