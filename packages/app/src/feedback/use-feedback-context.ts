import { useCallback } from "react";
import { Platform } from "react-native";

import { getIsElectron } from "@/constants/platform";
import { describeConnectionKind } from "@/diagnostics/app-diagnostic-report";
import type { FeedbackContextFacts, FeedbackHostFacts } from "@/feedback/feedback-payload";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { resolveAppVersion } from "@/utils/app-version";

/**
 * Gathers the small set of triage facts attached to a feedback report. Read on
 * demand (when the sheet opens) rather than subscribed, so an unrelated host
 * reconnect can't rewrite the block the reporter is currently reading.
 */
export function useCollectFeedbackFacts(): () => FeedbackContextFacts {
  const hosts = useHosts();

  return useCallback((): FeedbackContextFacts => {
    const store = getHostRuntimeStore();
    const hostFacts: FeedbackHostFacts[] = hosts.map((host) => {
      const snapshot = store.getSnapshot(host.serverId);
      const serverInfo = snapshot?.client?.getLastServerInfoMessage() ?? null;
      return {
        status: snapshot?.connectionStatus ?? "not started",
        connectionKind: snapshot?.activeConnection
          ? describeConnectionKind(snapshot.activeConnection.type)
          : null,
        daemonVersion: serverInfo?.version ?? null,
      };
    });

    return {
      appVersion: resolveAppVersion(),
      platform: Platform.OS,
      isDesktopApp: getIsElectron(),
      hosts: hostFacts,
    };
  }, [hosts]);
}
