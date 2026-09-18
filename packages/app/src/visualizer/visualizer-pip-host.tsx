// Mount point + lazy boundary for the picture-in-picture Visualizer.
//
// This module is imported eagerly by the window host, so it must stay
// light: `visualizer-pip.tsx` transitively pulls the vendored render layer, and
// Metro does not tree-shake (docs/feature-flags.md), so the only way a disabled
// Visualizer genuinely costs nothing is a React.lazy split. Same boundary
// visualizer-panel-registration.tsx draws for the tab.
//
// It also owns the mutual exclusion that makes the "one canvas" decision real:
// PIP renders only when no Visualizer TAB exists in the active workspace. Both
// surfaces host their own guest, so letting them coexist would mean two
// simulations and two star fields - exactly the doubled per-frame cost the
// charter warns about.
//
// The render gate below keeps that guarantee frame-tight, but it is NOT what
// enforces the invariant: `useReconcileVisualizerSurface` writes the setting
// back to false so the closed state is real rather than merely hidden. Parking
// PIP silently is what made its old header button dead chrome - see the bug note
// in use-visualizer-surface.ts.
import { lazy, Suspense } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFeatureEnabled } from "@/features/use-feature-enabled";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useAppSettings } from "@/hooks/use-settings";
import { useReconcileVisualizerSurface } from "@/visualizer/use-visualizer-surface";
import { useVisualizerTabOwnerKey } from "@/visualizer/visualizer-tab-owner";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";

const VisualizerPipLazy = lazy(async () => {
  const module = await import("@/visualizer/visualizer-pip");
  return { default: module.VisualizerPip };
});

export interface VisualizerPipHostProps {
  serverId: string;
  /** Empty before the route has resolved a workspace - the host renders nothing
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
  // Never on mobile. Not "degraded on mobile" - absent. A floating viewport you
  // drag around makes no sense on a single-pane phone layout, where the chat
  // already owns the whole screen and there is nothing to float over. Crossing
  // the breakpoint (resizing the window, rotating a tablet) unmounts it live;
  // the setting is untouched, so it returns when you cross back. The Visualizer
  // button still opens the normal full tab, which is the mobile answer.
  const isCompact = useIsCompactFormFactor();
  const { settings } = useAppSettings();
  const appVisible = useAppVisible();

  const hasVisualizerTab = useVisualizerTabOwnerKey() !== null;
  useReconcileVisualizerSurface(hasVisualizerTab, isVisible);

  const shown = !(
    !isVisible ||
    !appVisible ||
    isCompact ||
    !workspaceId ||
    !visualizerEnabled ||
    !settings.visualizerPipOpen ||
    settings.visualizerBackgroundOpen ||
    hasVisualizerTab
  );
  // Release inactive guests immediately, including on close and minimization.
  // An exit-fade hold would overlap a replacement and retain its subscriptions.
  if (!shown) {
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
        onOpenFile={onOpenFile}
      />
    </Suspense>
  );
}
