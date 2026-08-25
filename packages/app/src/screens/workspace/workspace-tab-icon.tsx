import { useMemo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { BlobLoader, ThemedBlobLoader } from "@/components/blob-loader";
import { Siren } from "@/components/icons/material-icons";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PersonalityProviderIcon } from "@/components/personality-provider-icon";
import { StatusPulseGlow } from "@/components/status-pulse-glow";
import { StatusBucketIcon, isAttentionStatusBucket } from "@/components/status-bucket-icon";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";
import { useIconSize, type Theme } from "@/styles/theme";
import type { IconSizeProp } from "@/components/icons/icon-size";

export interface WorkspaceTabPresentation {
  key: string;
  kind: WorkspaceTabDescriptor["kind"];
  label: string;
  subtitle: string;
  titleState: "ready" | "loading";
  icon: React.ComponentType<{ size?: IconSizeProp; color?: string }>;
  statusBucket: SidebarStateBucket | null;
  /** Personality spinner colors for the busy loader; null ⇒ theme spinner. */
  personalitySpinner?: { glowA: string; glowB: string } | null;
  /** Provider id - fills the non-loading agent glyph with the personality gradient. */
  provider?: string;
  /** Busy glyph while running: the AI blob loader (default) or a plain spinner. */
  busyLoader?: "blob" | "spinner";
}

interface WorkspaceTabIconProps {
  presentation: WorkspaceTabPresentation;
  active?: boolean;
  /** Accent-colored icon - marks the selected tab in the desktop tabs row. */
  accent?: boolean;
  /** Accepted by shared call sites whose status renderer uses a surface knockout. */
  backdrop?: "surface0" | "surface1";
  size?: number;
}

export function WorkspaceTabIcon({
  presentation,
  active = false,
  accent = false,
  size,
}: WorkspaceTabIconProps): ReactElement {
  const iconSize = useIconSize();
  const resolvedSize = size ?? iconSize.sm;
  let iconColor = styles.iconInactive.color;
  if (accent) {
    iconColor = styles.iconAccent.color;
  } else if (active) {
    iconColor = styles.iconActive.color;
  }
  const bucket = presentation.statusBucket;
  const shouldShowLoader = shouldRenderSyncedStatusLoader({ bucket });
  const Icon = presentation.icon;
  const agentIconWrapperStyle = useMemo(
    () => [styles.agentIconWrapper, { width: resolvedSize, height: resolvedSize }],
    [resolvedSize],
  );

  // Terminal activity is workspace-level attention with one unambiguous source:
  // the terminal tab itself. Give every active/attention terminal the same blue
  // siren rather than making users infer which generic loader or coloured status
  // icon caused the workspace dot. The daemon clears the bucket when this terminal
  // is focused, so the ordinary terminal glyph returns with the cleared state.
  if (presentation.kind === "terminal" && bucket !== null) {
    return (
      <View style={agentIconWrapperStyle}>
        <ThemedTerminalActivitySiren size={resolvedSize} uniProps={terminalActivityThemeMapping} />
      </View>
    );
  }

  if (shouldShowLoader) {
    // Non-AI panels (a browser tab fetching a page) get the plain circular
    // indicator - the blob loader means "a model is working" and stays reserved
    // for that.
    if (presentation.busyLoader === "spinner") {
      return (
        <View style={agentIconWrapperStyle}>
          <LoadingSpinner size={resolvedSize} />
        </View>
      );
    }

    const spinner = presentation.personalitySpinner;
    return (
      <View style={agentIconWrapperStyle}>
        {spinner ? (
          <BlobLoader size={resolvedSize - 1} glowA={spinner.glowA} glowB={spinner.glowB} />
        ) : (
          <ThemedBlobLoader size={resolvedSize - 1} />
        )}
      </View>
    );
  }

  // Actionable states swap the whole glyph for the shared attention badge -
  // the same icon the sidebar workspace rows show for this bucket - instead
  // of overlaying a tiny dot. The wrapper keeps the tab's icon box size, so
  // the swap causes no layout shift; the normal icon returns when the bucket
  // clears.
  if (isAttentionStatusBucket(bucket)) {
    return (
      <View style={agentIconWrapperStyle}>
        <StatusBucketIcon bucket={bucket} size={resolvedSize} />
      </View>
    );
  }

  const spinner = presentation.personalitySpinner;
  return (
    <View style={agentIconWrapperStyle}>
      {spinner && presentation.provider ? (
        <PersonalityProviderIcon
          provider={presentation.provider}
          size={resolvedSize}
          glowA={spinner.glowA}
          glowB={spinner.glowB}
        />
      ) : (
        <Icon size={resolvedSize} color={iconColor} />
      )}
    </View>
  );
}

function TerminalActivitySiren({ size, theme }: { size: number; theme: Theme }): ReactElement {
  return (
    <StatusPulseGlow color={theme.colors.statusInfo} size={size}>
      <Siren size={size} color={theme.colors.statusInfo} />
    </StatusPulseGlow>
  );
}

const terminalActivityThemeMapping = (theme: Theme) => ({ theme });
const ThemedTerminalActivitySiren = withUnistyles(TerminalActivitySiren);

const styles = StyleSheet.create((theme) => ({
  agentIconWrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  iconActive: {
    color: theme.colors.foreground,
  },
  iconAccent: {
    color: theme.colors.accentBright,
  },
  iconInactive: {
    color: theme.colors.foregroundMuted,
  },
}));
