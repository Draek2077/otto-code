import { type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { Folder } from "@/components/icons/material-icons";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { resolveModelLabel, resolveProviderLabel } from "@/utils/provider-definitions";

const PROVIDER_ICON_SIZE = 14;

export interface ProjectRowProps {
  /** Provider glyph for the project's target agent, when known. */
  provider: string | null;
  /** Resolved project name; the row renders nothing when this isn't known. */
  projectName: string | null;
}

/**
 * Identity row shown under the header of orchestration run cards: the provider
 * glyph followed by the project name (see runs-screen.tsx). Artifact and
 * Schedule cards split this into two lines instead — ExecutorRow (who ran it)
 * plus ProjectNameLine (where) — via the components below.
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

export interface ExecutorRowProps {
  /** Host the item lives on — used to resolve the provider's display label. */
  serverId: string;
  /** Name of the personality that ran (last ran) the item; null when none. */
  personalityName: string | null;
  /** Provider id that executed the run — drives both the glyph and the label. */
  provider: string | null;
  /** Model id that executed the run, when known. */
  model: string | null;
}

/**
 * The "who ran it" identity line for Artifact and Schedule cards: the provider
 * glyph followed by `Personality · Provider · Model` (or just `Provider ·
 * Model` when no personality was used). This reflects the actual last executor,
 * not a configured "Team's Role" slot. Renders nothing when nothing is known.
 */
export function ExecutorRow({
  serverId,
  personalityName,
  provider,
  model,
}: ExecutorRowProps): ReactElement | null {
  // Cached per host (cwd-agnostic); dedupes across every card on the same host.
  const { entries } = useProvidersSnapshot(serverId, { enabled: Boolean(provider) });
  const providerLabel = provider ? resolveProviderLabel(provider, entries) : null;
  // Show the model's friendly name (e.g. "Opus 4.8"), not its raw id. Needs the
  // provider to locate the right model list; without one, fall back to the id.
  let modelLabel: string | null = null;
  if (model) {
    modelLabel = provider ? resolveModelLabel(provider, model, entries) : model;
  }
  const parts = [personalityName, providerLabel, modelLabel].filter((part): part is string =>
    Boolean(part),
  );
  if (parts.length === 0) {
    return null;
  }
  return (
    <View style={styles.row}>
      {provider ? <ProviderGlyph provider={provider} /> : null}
      <Text style={styles.text} numberOfLines={1}>
        {parts.join(" · ")}
      </Text>
    </View>
  );
}

export interface ProjectNameLineProps {
  /** Resolved project name; renders nothing when unknown. */
  projectName: string | null;
}

/** The project name on its own line, below the executor line, so the two read
 * as distinct facts ("who ran it" vs. "which project"). */
export function ProjectNameLine({ projectName }: ProjectNameLineProps): ReactElement | null {
  if (!projectName) {
    return null;
  }
  return (
    <View style={styles.row}>
      <Folder size={PROVIDER_ICON_SIZE} color={styles.icon.color} />
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
