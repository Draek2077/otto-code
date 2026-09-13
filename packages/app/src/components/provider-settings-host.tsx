import { SettingsSearchProvider } from "@/screens/settings-search/target";
import React, { useCallback } from "react";
import { ProviderDiagnosticSheet } from "@/components/provider-diagnostic-sheet";
import { OverlayLayerProvider } from "@/lib/overlay-root";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";

export function ProviderSettingsHost() {
  const serverId = useProviderSettingsStore((state) => state.serverId);
  const provider = useProviderSettingsStore((state) => state.provider);
  const settingId = useProviderSettingsStore((state) => state.settingId);
  const visible = useProviderSettingsStore((state) => state.visible);
  const overlayParentLayer = useProviderSettingsStore((state) => state.overlayParentLayer);
  const close = useProviderSettingsStore((state) => state.close);

  const handleClose = useCallback(() => {
    close();
  }, [close]);

  if (!serverId || !provider) {
    return null;
  }

  return (
    <OverlayLayerProvider layer={overlayParentLayer}>
      <SettingsSearchProvider settingId={visible ? settingId : null}>
        <ProviderDiagnosticSheet
          key={`${serverId}:${provider}`}
          provider={provider}
          serverId={serverId}
          visible={visible}
          onClose={handleClose}
        />
      </SettingsSearchProvider>
    </OverlayLayerProvider>
  );
}
