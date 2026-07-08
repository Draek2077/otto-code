import { type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";

const PROVIDER_ICON_SIZE = 14;

export interface ProjectRowProps {
  /** Provider glyph for the project's target agent, when known. */
  provider: string | null;
  /** Resolved project name; the row renders nothing when this isn't known. */
  projectName: string | null;
}

/**
 * Identity row shown under the header of both the Artifact and Schedule
 * cards: the provider glyph followed by the project name, so the two grids
 * read the same way at a glance (see artifact-card.tsx and schedule-card.tsx).
 */
export function ProjectRow({ provider, projectName }: ProjectRowProps): ReactElement | null {
  if (!projectName) {
    return null;
  }
  return (
    <View style={styles.row}>
      {provider ? <ProviderGlyph provider={provider} /> : null}
      <Text style={styles.text} numberOfLines={1}>
        {projectName}
      </Text>
    </View>
  );
}

function ProviderGlyph({ provider }: { provider: string }): ReactElement {
  const Icon = getProviderIcon(provider);
  return <Icon size={PROVIDER_ICON_SIZE} color={styles.icon.color} />;
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  icon: {
    color: theme.colors.foregroundMuted,
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
