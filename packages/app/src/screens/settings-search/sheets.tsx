import React, { useCallback, type ReactNode } from "react";
import {
  AdaptiveModalSheet,
  type AdaptiveModalSheetProps,
} from "@/components/adaptive-modal-sheet";
import { TabbedModalSheet, type TabbedModalSheetProps } from "@/components/ui/tabbed-modal-sheet";
import type { ContextBridge } from "@/components/ui/isolated-bottom-sheet-modal";
import { useSettingsSearchContextBridge } from "./target";

function useBridge(bridge: ContextBridge | null | undefined) {
  const searchBridge = useSettingsSearchContextBridge();
  return useCallback(
    (children: ReactNode) => searchBridge(bridge ? bridge(children) : children),
    [bridge, searchBridge],
  );
}

/** Reuses the stable portal bridge and the sheet's actual scroll viewport. */
export function SettingsAdaptiveModalSheet({ contextBridge, ...props }: AdaptiveModalSheetProps) {
  const bridge = useBridge(contextBridge);
  return <AdaptiveModalSheet {...props} contextBridge={bridge} />;
}

export function SettingsTabbedModalSheet<T extends string>({
  contextBridge,
  ...props
}: TabbedModalSheetProps<T>) {
  const bridge = useBridge(contextBridge);
  return <TabbedModalSheet {...props} contextBridge={bridge} />;
}
