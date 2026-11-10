import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import { useVisualizerWindowVisible } from "./use-window-visible";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { Alert } from "@/components/ui/alert";
import { visualizerPlacement, type VisualizerPreferences } from "./preferences";
import { retainVisualizerBackgrounds } from "./background-retention";
const Surface = lazy(async () => ({ default: (await import("./surface")).VisualizerSurface }));
const Frame = lazy(async () => ({ default: (await import("./pip-frame")).VisualizerPipFrame }));
export function VisualizerWindowHost() {
  useEffect(retainVisualizerBackgrounds, []);
  const { settings, updateSettings } = useAppSettings(),
    active = useActiveWorkspaceSelection(),
    visible = useVisualizerWindowVisible();
  const [error, setError] = useState("");
  const save = useCallback(
    (patch: Partial<VisualizerPreferences>) => {
      void updateSettings(patch).catch(() =>
        setError("The Visualizer placement could not be saved."),
      );
    },
    [updateSettings],
  );
  if (visualizerPlacement(settings) !== "pip" || !active) return null;
  return (
    <Suspense fallback={null}>
      <Frame preferences={settings} save={save} shown={visible}>
        {error ? <Alert variant="error" description={error} /> : null}
        {visible ? (
          <Surface
            key={`${active.serverId}:${active.workspaceId}`}
            serverId={active.serverId}
            workspaceId={active.workspaceId}
            placement="pip"
            active
          />
        ) : null}
      </Frame>
    </Suspense>
  );
}
