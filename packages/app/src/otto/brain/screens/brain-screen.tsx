import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { MenuHeader } from "@/components/headers/menu-header";
import { Alert } from "@/components/ui/alert";
import { SegmentedControl } from "./ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { createBrainStyles, BrainScreenThemeProvider, type BrainScreenTheme } from "./theme";
import { BrainScreensProvider, useBrainHost } from "./context";
import type { BrainScreenPort } from "./contracts/port";
import { BrainOverviewTab } from "./overview/overview";
import { BrainLibraryTab } from "./library/library";
import { BrainOperationErrorProvider } from "./library/common";
import { BrainModelsTab } from "./models/models";
import { BrainBenchmarksTab } from "./benchmark/benchmark";
import { BrainLogsTab } from "./logs/logs";
import { resolveBrainAvailability, type BrainAvailabilityMessage } from "./brain-availability";
import { useBrainCapabilities, useBrainStatus } from "./data";
type BrainTab = "overview" | "models" | "library" | "benchmarks" | "logs";

const TAB_OPTIONS: { value: BrainTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "library", label: "Library" },
  { value: "models", label: "Models" },
  { value: "benchmarks", label: "Benchmark" },
  { value: "logs", label: "Logs" },
];

/** Shown where a tab needs a brain capability the far side does not serve. */
function CapabilityGap({ what, inset = false }: { what: string; inset?: boolean }) {
  const styles = useStyles();
  const alert = (
    <Alert
      variant="info"
      title="Update the brain on this host"
      description={`This brain does not serve ${what}. Update it to use this tab.`}
    />
  );
  return inset ? <View style={styles.alertInset}>{alert}</View> : alert;
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
  const styles = useStyles();
  const isCompact = useIsCompactFormFactor();
  const [tab, setTab] = useState<BrainTab>("overview");
  const isConnected = useBrainHost().connected;
  const manageSupported = useBrainHost().access.manage;
  const isRemote = useBrainHost().mode === "remote";

  // Overview retains resource demand; this shared status view reads capabilities
  // from the same parent-owned host snapshot used by the renderer.
  const statusQuery = useBrainStatus({ enabled: isConnected });
  const capabilities = useBrainCapabilities(statusQuery.data ?? null);
  const brainAvailability = resolveBrainAvailability({
    isConnected,
    status: statusQuery.data ?? null,
    statusError: statusQuery.error,
  });
  const tabBrainAvailability: BrainAvailabilityMessage | null =
    tab === "overview" ? null : brainAvailability;
  const canRestartRemotely = capabilities?.restart === true && capabilities.writable === true;
  const canWriteRemotely = capabilities?.writable === true;
  const canRunRemoteModelJobs = capabilities?.jobs === true && canWriteRemotely;
  const canRunRemoteBench = capabilities?.jobs === true && canWriteRemotely;
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
    if (tabBrainAvailability) {
      return (
        <Alert
          variant="error"
          title={tabBrainAvailability.title}
          description={tabBrainAvailability.description}
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
            showRuntime={manageSupported}
            // A remote Brain must grant configuration access before this client
            // advertises a control that can change its runtime. The runtime
            // status itself remains visible through `showRuntime`.
            canManageRuntime={manageSupported && (!isRemote || canWriteRemotely)}
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
          <CapabilityGap what="the model inventory" inset />
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
    tabBrainAvailability,
    capabilities,
    canRestartRemotely,
    canRunRemoteBench,
    canRunRemoteModelJobs,
    canWriteRemotely,
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
    const alertOnly = tabBrainAvailability !== null;
    content = (
      <View style={styles.fullHeightContent}>
        {alertOnly ? <View style={styles.alertInset}>{body}</View> : body}
      </View>
    );
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

export interface BrainHostOption {
  value: string;
  label: string;
}
export interface BrainScreenProps {
  /** Paseo's contributed surface already owns its header and host picker. */
  embedded?: boolean;
  port: BrainScreenPort | null;
  theme: BrainScreenTheme;
  hosts?: BrainHostOption[];
  selectedHostId: string | null;
  onSelectHost?: (serverId: string) => void;
}
export function BrainScreen(props: BrainScreenProps) {
  return (
    <BrainScreenThemeProvider theme={props.theme}>
      <BrainScreenBody {...props} />
    </BrainScreenThemeProvider>
  );
}
function BrainScreenBody({
  port,
  hosts,
  selectedHostId,
  onSelectHost,
  embedded,
}: BrainScreenProps) {
  const styles = useStyles();
  return (
    <View style={styles.container}>
      {!embedded ? <MenuHeader title="Brain" /> : null}
      <View style={styles.body}>
        {port === null || selectedHostId === null ? (
          <View style={styles.centered}>
            <Text style={styles.message}>Connect a host to use Brain.</Text>
          </View>
        ) : (
          <BrainScreensProvider key={selectedHostId} port={port}>
            <BrainOperationErrorProvider>
              <BrainHostPanel
                serverId={selectedHostId}
                hostOptions={hosts}
                onSelectHost={onSelectHost}
              />
            </BrainOperationErrorProvider>
          </BrainScreensProvider>
        )}
      </View>
    </View>
  );
}
const useStyles = createBrainStyles((theme) => ({
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
  alertInset: {
    padding: theme.spacing[4],
  },
}));
