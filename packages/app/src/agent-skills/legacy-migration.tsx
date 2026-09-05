import { useEffect } from "react";
import { getDesktopDaemonStatus, shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import {
  deleteLegacySkillSelection,
  readLegacySkillSelection,
} from "@/desktop/daemon/desktop-daemon";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { createLegacyMigrationController } from "./legacy-migration-controller";

// COMPAT(desktopSkillSelectionMigration): added in v0.4.0; remove after 2027-02-16.
export function LegacyAgentSkillsMigration() {
  useEffect(() => {
    if (!shouldUseDesktopDaemon()) return;
    const runtime = getHostRuntimeStore();
    const migration = createLegacyMigrationController({
      getLocalStatus: getDesktopDaemonStatus,
      getConnectedClient(serverId) {
        const snapshot = runtime.getSnapshot(serverId);
        const info = snapshot?.client?.getLastServerInfoMessage();
        return snapshot?.connectionStatus === "online" &&
          info?.serverId === serverId &&
          info.desktopManaged === true
          ? snapshot.client
          : null;
      },
      read: readLegacySkillSelection,
      remove: deleteLegacySkillSelection,
      schedule(callback, delayMs) {
        const timer = setTimeout(callback, delayMs);
        return () => clearTimeout(timer);
      },
      onError(error) {
        console.error("[Agent skills] Legacy selection migration failed; will retry", error);
      },
    });
    let connectionKey: string | null = null;
    const refreshConnections = () => {
      const nextKey = runtime
        .getHosts()
        .map(({ serverId }) => {
          const host = runtime.getSnapshot(serverId);
          return `${serverId}:${host?.connectionStatus}:${host?.clientGeneration}:${host?.connectionEpoch}`;
        })
        .sort()
        .join(",");
      if (nextKey === connectionKey) return;
      connectionKey = nextKey;
      void migration.refresh();
    };
    const unsubscribe = runtime.subscribeAll(refreshConnections);
    refreshConnections();
    return () => {
      unsubscribe();
      migration.dispose();
    };
  }, []);
  return null;
}
