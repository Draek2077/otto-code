import { useMemo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { BlobLoader, ThemedBlobLoader } from "@/components/blob-loader";
import { PersonalityProviderIcon } from "@/components/personality-provider-icon";
import { StatusBucketIcon, isAttentionStatusBucket } from "@/components/status-bucket-icon";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";
import { useIconSize } from "@/styles/theme";

export interface WorkspaceTabPresentation {
  key: string;
  kind: WorkspaceTabDescriptor["kind"];
  label: string;
  subtitle: string;
  titleState: "ready" | "loading";
  icon: React.ComponentType<{ size: number; color: string }>;
  statusBucket: SidebarStateBucket | null;
  /** Personality spinner colors for the busy loader; null ⇒ theme spinner. */
  personalitySpinner?: { glowA: string; glowB: string } | null;
  /** Provider id — fills the non-loading agent glyph with the personality gradient. */
  provider?: string;
}

interface WorkspaceTabIconProps {
  presentation: WorkspaceTabPresentation;
  active?: boolean;
  /** Accent-colored icon — marks the selected tab in the desktop tabs row. */
  accent?: boolean;
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

  if (shouldShowLoader) {
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

  // Actionable states swap the whole glyph for the shared attention badge —
  // the same icon the sidebar workspace rows show for this bucket — instead
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
