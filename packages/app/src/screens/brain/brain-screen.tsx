/**
 * The Brain page: everything the brain's TUI does, outside any workspace.
 *
 * Layout follows `stats-screen.tsx`, the closest existing precedent for a
 * top-level tabbed page: a pinned `MenuHeader`, a pinned toolbar band holding
 * the tabs, and exactly one scroll region below it. No screen-level scroll, so
 * the tabs never scroll out of reach.
 *
 * Per-host, not merged. A host picker appears only when more than one connected
 * host has a brain: two brains are two machines with their own GPUs, models and
 * logs, and a combined view would be meaningless.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Alert } from "@/components/ui/alert";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHostFeature } from "@/runtime/host-features";
import { useHosts, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  useActiveWorkspaceSelection,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { BrainBenchmarksTab } from "./benchmarks-tab";
import { BrainLibraryTab } from "./library-tab";
import { BrainLogsTab } from "./logs-tab";
import { BrainModelsTab } from "./models-tab";
import { BrainOverviewTab } from "./overview-tab";
import { useBrainCapabilities, useBrainStatus } from "./use-brain-data";

type BrainTab = "overview" | "models" | "library" | "benchmarks" | "logs";

const TAB_OPTIONS: { value: BrainTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "library", label: "Library" },
  { value: "models", label: "Models" },
  { value: "benchmarks", label: "Benchmark" },
  { value: "logs", label: "Logs" },
];

/** Shown where a tab needs a brain capability the far side does not serve. */
function CapabilityGap({ what }: { what: string }) {
  return (
    <Alert
      variant="info"
      title="Update the brain on this host"
      description={`This brain does not serve ${what}. Update it to use this tab.`}
    />
  );
}

function BrainHostPanel({
  serverId,
  hostOptions,
  onSelectHost,
}: {
  serverId: string;
  hostOptions?: { value: string; label: string }[];
  onSelectHost?: (value: string) => void;
}) {
  const isCompact = useIsCompactFormFactor();
  const [tab, setTab] = useState<BrainTab>("overview");
  const isConnected = useHostRuntimeIsConnected(serverId);
  const consoleSupported = useHostFeature(serverId, "brainConsole");
  const manageSupported = useHostFeature(serverId, "brainManage");
  const { config } = useDaemonConfig(serverId);
  const isRemote = config?.brain.mode === "remote";

  // The Overview tab is the one that wants live resource telemetry, so it owns
  // its own status query. This cheap one exists only to read `capabilities`.
  const statusQuery = useBrainStatus(serverId, { enabled: isConnected && consoleSupported });
  const capabilities = useBrainCapabilities(statusQuery.data ?? null);
  const canRestartRemotely = capabilities?.restart === true && capabilities.writable === true;
  const canWriteRemotely = capabilities?.writable === true;
  const canRunRemoteModelJobs = capabilities?.jobs === true && canWriteRemotely;
  const canRunRemoteBench = capabilities?.jobs === true;
  // A remote host that has not explicitly granted configuration access must not
  // advertise a Library it cannot act on. More importantly, this is derived
  // from the selected brain's live capability, never from the local daemon.
  const tabOptions = useMemo(
    () =>
      isRemote && capabilities?.writable !== true
        ? TAB_OPTIONS.filter((option) => option.value !== "library")
        : TAB_OPTIONS,
    [capabilities?.writable, isRemote],
  );

  useEffect(() => {
    if (!tabOptions.some((option) => option.value === tab)) {
      setTab("overview");
    }
  }, [tab, tabOptions]);

  const body = useMemo(() => {
    if (!consoleSupported) {
      return (
        <Alert
          variant="info"
          title="Update the host"
          description="This host's daemon does not serve the Brain console. Update it to use this page."
        />
      );
    }
    switch (tab) {
      case "overview":
        return (
          <BrainOverviewTab
            serverId={serverId}
            isConnected={isConnected}
            // A remote brain may expose its host-owned restart. Start and stop
            // remain daemon ownership, so a proxy renders only Restart.
            canControlLifecycle={!isRemote || canRestartRemotely}
            showStartStop={!isRemote}
            // Runtime reads and installs now reach the brain through host-owned
            // management routes, so remote and owning daemons report the same runtime.
            canManageRuntime={manageSupported}
            canInstallRuntime={!isRemote || canWriteRemotely}
          />
        );
      case "models":
        return capabilities?.inventory ? (
          <BrainModelsTab
            serverId={serverId}
            isConnected={isConnected}
            // `writable` is the brain's own allowRemoteConfig. A brain you may
            // use is not thereby a brain whose models you may delete.
            canWrite={capabilities.writable}
            canRunJobs={manageSupported && (!isRemote || canRunRemoteModelJobs)}
          />
        ) : (
          <CapabilityGap what="the model inventory" />
        );
      case "library":
        return (
          <BrainLibraryTab
            serverId={serverId}
            isConnected={isConnected}
            isRemote={isRemote}
            canWrite={canWriteRemotely}
          />
        );
      case "benchmarks":
        return (
          <BrainBenchmarksTab
            serverId={serverId}
            isConnected={isConnected}
            // A remote benchmark is executable only when the selected brain,
            // not this local daemon, advertises its host-owned job API.
            canRunJobs={manageSupported && (!isRemote || canRunRemoteBench)}
          />
        );
      case "logs":
        return capabilities?.logs ? (
          <BrainLogsTab serverId={serverId} isConnected={isConnected} />
        ) : (
          <CapabilityGap what="a log tail" />
        );
    }
  }, [
    capabilities,
    canRestartRemotely,
    canRunRemoteBench,
    canRunRemoteModelJobs,
    canWriteRemotely,
    consoleSupported,
    isConnected,
    isRemote,
    manageSupported,
    serverId,
    tab,
  ]);

  let content: ReactNode;
  if (tab === "models" || tab === "benchmarks") {
    // This tab owns a split surface that must consume the remaining page
    // height. Giving it the page scroll would make its inner scroll regions
    // size to content instead of the visible viewport.
    content = <View style={styles.fullHeightContent}>{body}</View>;
  } else if (tab === "logs") {
    content = (
      <View style={[styles.fullHeightContent, styles.paddedFullHeightContent]}>{body}</View>
    );
  } else {
    content = (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={!isWeb}
      >
        {body}
      </ScrollView>
    );
  }

  return (
    <View style={styles.panel}>
      {/* Toolbar band: pinned above the scroll region so the tabs stay reachable
          however far the content below scrolls. */}
      <View style={styles.toolbar}>
        {hostOptions && onSelectHost && hostOptions.length > 1 ? (
          <View style={styles.toolbarControl}>
            <SegmentedControl
              size="sm"
              wrap
              options={hostOptions}
              value={serverId}
              onValueChange={onSelectHost}
              testID="brain-host"
            />
          </View>
        ) : null}
        <View style={styles.toolbarControl}>
          <SegmentedControl
            size="sm"
            wrap={isCompact}
            options={tabOptions}
            value={tab}
            onValueChange={setTab}
            testID="brain-tab"
          />
        </View>
      </View>
      {content}
    </View>
  );
}

export function BrainScreen() {
  const hosts = useHosts();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  // `useHosts()` returns every host ever registered, in storage order - not
  // necessarily the one the user is actually working with. Left to `hosts[0]`,
  // a machine with more than one saved host (a dev daemon alongside the
  // installed app, a WSL daemon, an old connection) could land the page on a
  // disconnected host and show its brain as permanently offline, even while
  // the host the user actually configured is connected and running. Prefer,
  // in order: an explicit pick, the workspace host currently or most recently
  // in view (matching the rail's own fallback, see use-brain-rail-state.ts),
  // then the local desktop daemon, before falling back to the stored order.
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const localServerId = useLocalDaemonServerId();

  const activeServerId = useMemo(() => {
    if (selectedServerId && hosts.some((host) => host.serverId === selectedServerId)) {
      return selectedServerId;
    }
    const preferredServerId =
      activeWorkspaceSelection?.serverId ?? lastWorkspaceSelection?.serverId ?? localServerId;
    if (preferredServerId && hosts.some((host) => host.serverId === preferredServerId)) {
      return preferredServerId;
    }
    return hosts[0]?.serverId ?? null;
  }, [hosts, selectedServerId, activeWorkspaceSelection, lastWorkspaceSelection, localServerId]);

  const hostOptions = useMemo(
    () => hosts.map((host) => ({ value: host.serverId, label: host.label })),
    [hosts],
  );

  const handleSelectHost = useCallback((value: string) => setSelectedServerId(value), []);

  return (
    <View style={styles.container}>
      <MenuHeader title="Brain" />
      {activeServerId === null ? (
        <View style={styles.centered}>
          <Text style={styles.message}>No hosts connected</Text>
        </View>
      ) : (
        <View style={styles.body}>
          {/* Only worth showing with a choice to make. One host needs no picker. */}
          {/* Keep the panel mounted while changing hosts so the selected content
              tab survives; the panel's capability guard handles unsupported tabs. */}
          <BrainHostPanel
            serverId={activeServerId}
            hostOptions={hostOptions}
            onSelectHost={handleSelectHost}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  body: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  panel: {
    flex: 1,
  },
  toolbar: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[3],
    rowGap: theme.spacing[2],
    columnGap: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  toolbarControl: {
    flexShrink: 0,
    alignItems: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
  },
  fullHeightContent: {
    flex: 1,
    minHeight: 0,
  },
  paddedFullHeightContent: {
    padding: theme.spacing[4],
  },
  placeholder: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
