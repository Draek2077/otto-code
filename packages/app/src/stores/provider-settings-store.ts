import { create } from "zustand";

interface ProviderSettingsTarget {
  serverId: string;
  provider: string;
  overlayParentLayer?: number;
  settingId?: string | null;
}

interface ProviderSettingsStoreState {
  serverId: string | null;
  provider: string | null;
  overlayParentLayer: number;
  settingId: string | null;
  visible: boolean;
  open: (target: ProviderSettingsTarget) => void;
  close: () => void;
}

export const useProviderSettingsStore = create<ProviderSettingsStoreState>()((set) => ({
  serverId: null,
  provider: null,
  overlayParentLayer: 0,
  settingId: null,
  visible: false,
  open: ({ serverId, provider, overlayParentLayer = 0, settingId = null }) => {
    set({ serverId, provider, overlayParentLayer, settingId, visible: true });
  },
  close: () => {
    set({ visible: false });
  },
}));
