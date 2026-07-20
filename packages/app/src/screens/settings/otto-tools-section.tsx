// Otto Tools categorized settings — daemon-wide, per-group gating of the Otto
// tool catalog on the MCP (Claude) path, plus the daemon-wide agent-behavior
// and metadata-generation toggles. All of these are daemon settings, so they
// live in Host settings and read/write via useDaemonConfig/patchConfig.
//
// i18n: copy here is English-only pending a translation pass (build-first,
// translate-last). Do not add locale keys for this surface yet.
import { useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@otto-code/protocol/messages";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { BROWSER_TOOLS_TITLE, BROWSER_TOOLS_WARNING } from "./browser-tools-config";
import {
  AGENT_BEHAVIOR_META,
  BROWSER_TOOL_GROUP_META,
  createAgentBehaviorPatch,
  createMetadataGenerationEnabledPatch,
  createPreferWriterPersonalitiesPatch,
  createToolGroupsPatch,
  isAgentBehaviorEnabled,
  isMetadataGenerationEnabled,
  isPreferWriterPersonalities,
  isToolGroupEnabled,
  OTTO_CORE_TOOL_GROUP_META,
  type AgentBehaviorMeta,
  type OttoToolGroupMeta,
} from "./otto-tools-config";

// Non-first rows in a grouped card carry a top divider — the iOS-style split
// line every other settings section uses. The first row in a card omits it.
const ROW_WITH_BORDER = [settingsStyles.row, settingsStyles.rowBorder];

/**
 * The single detection point for the per-group MCP tool gating capability.
 * COMPAT(mcpToolGroups): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
 */
export function useMcpToolGroupsFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.mcpToolGroups === true,
  );
}

/**
 * The single detection point for the daemon-wide agent-behavior toggles.
 * COMPAT(agentBehaviorToggles): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
 */
export function useAgentBehaviorTogglesFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentBehaviorToggles === true,
  );
}

/**
 * The single detection point for the metadata-generation master toggles.
 * COMPAT(metadataGenerationEnabled): added in v0.6.4, drop the gate when daemon floor >= v0.6.4.
 */
export function useMetadataGenerationEnabledFeature(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.metadataGenerationEnabled === true,
  );
}

function toErrorMessage(error: unknown): string | null {
  if (!error) {
    return null;
  }
  return error instanceof Error ? error.message : String(error);
}

// Presentational row inside a grouped card: title, description, and a switch,
// with an optional top divider so multiple rows read as one settings card. The
// switch handler is supplied by a wrapper (never an inline arrow) so this stays
// a pure view.
function ToggleRowView(props: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled: boolean;
  errorText: string | null;
  withBorder: boolean;
  testID: string;
  // Defaults to the title; overridden where an existing accessible name must be
  // preserved (e.g. the "Inject Otto tools" master, asserted by e2e).
  accessibilityLabel?: string;
}) {
  const {
    title,
    description,
    value,
    onValueChange,
    disabled,
    errorText,
    withBorder,
    testID,
    accessibilityLabel,
  } = props;
  return (
    <View style={withBorder ? ROW_WITH_BORDER : settingsStyles.row} testID={testID}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{description}</Text>
        {errorText ? <Text style={settingsStyles.rowError}>{errorText}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel ?? title}
        testID={`${testID}-switch`}
      />
    </View>
  );
}

// Shared mutation wiring for a single config toggle: a failed patch surfaces
// inline (via errorText) instead of silently reverting the switch.
function useToggleMutation(serverId: string) {
  const { patchConfig } = useDaemonConfig(serverId);
  return useMutation({
    mutationFn: async (patch: MutableDaemonConfigPatch) => {
      const result = await patchConfig(patch);
      if (!result) {
        throw new Error("Host disconnected");
      }
      return result;
    },
  });
}

function ToolGroupToggleRow(props: {
  serverId: string;
  config: MutableDaemonConfig | null;
  meta: OttoToolGroupMeta;
  // When the section master switch is off the group rows are inert: the values
  // are moot (no tools reach agents) so editing them would mislead.
  masterEnabled: boolean;
}) {
  const { serverId, config, meta, masterEnabled } = props;
  const mutation = useToggleMutation(serverId);
  const onValueChange = useCallback(
    (next: boolean) => {
      mutation.mutate(createToolGroupsPatch(config, meta.group, next));
    },
    [mutation, config, meta.group],
  );
  return (
    <ToggleRowView
      title={meta.label}
      description={meta.description}
      value={isToolGroupEnabled(config, meta.group)}
      onValueChange={onValueChange}
      disabled={mutation.isPending || !masterEnabled}
      errorText={toErrorMessage(mutation.error)}
      withBorder
      testID={`host-page-otto-tool-group-${meta.group}`}
    />
  );
}

function AgentBehaviorToggleRow(props: {
  serverId: string;
  config: MutableDaemonConfig | null;
  meta: AgentBehaviorMeta;
}) {
  const { serverId, config, meta } = props;
  const mutation = useToggleMutation(serverId);
  const onValueChange = useCallback(
    (next: boolean) => {
      mutation.mutate(createAgentBehaviorPatch(meta.key, next));
    },
    [mutation, meta.key],
  );
  return (
    <ToggleRowView
      title={meta.label}
      description={meta.description}
      value={isAgentBehaviorEnabled(config, meta.key)}
      onValueChange={onValueChange}
      disabled={mutation.isPending}
      errorText={toErrorMessage(mutation.error)}
      withBorder
      testID={`host-page-agent-behavior-${meta.key}`}
    />
  );
}

function MetadataGenerationEnabledRow(props: {
  serverId: string;
  config: MutableDaemonConfig | null;
}) {
  const { serverId, config } = props;
  const mutation = useToggleMutation(serverId);
  const onValueChange = useCallback(
    (next: boolean) => {
      mutation.mutate(createMetadataGenerationEnabledPatch(next));
    },
    [mutation],
  );
  return (
    <ToggleRowView
      title="Metadata generation"
      description="Let the daemon generate chat titles and other structured metadata. Costs extra tokens."
      value={isMetadataGenerationEnabled(config)}
      onValueChange={onValueChange}
      disabled={mutation.isPending}
      errorText={toErrorMessage(mutation.error)}
      withBorder
      testID="host-page-metadata-generation-enabled"
    />
  );
}

function PreferWriterPersonalitiesRow(props: {
  serverId: string;
  config: MutableDaemonConfig | null;
}) {
  const { serverId, config } = props;
  const mutation = useToggleMutation(serverId);
  const onValueChange = useCallback(
    (next: boolean) => {
      mutation.mutate(createPreferWriterPersonalitiesPatch(next));
    },
    [mutation],
  );
  return (
    <ToggleRowView
      title="Prefer Writer personalities"
      description="Route metadata generation to a role-matched Writer personality instead of the cheap default tier."
      value={isPreferWriterPersonalities(config)}
      onValueChange={onValueChange}
      disabled={mutation.isPending || !isMetadataGenerationEnabled(config)}
      errorText={toErrorMessage(mutation.error)}
      withBorder
      testID="host-page-metadata-generation-prefer-writer"
    />
  );
}

// The Otto Tools master row: injecting the Otto tool catalog into agents at all.
// Off = no Otto tools reach agents, so the category rows below are inert.
function OttoToolsMasterRow(props: { serverId: string; enabled: boolean }) {
  const { serverId, enabled } = props;
  const { t } = useTranslation();
  const mutation = useToggleMutation(serverId);
  const onValueChange = useCallback(
    (next: boolean) => {
      mutation.mutate({ mcp: { injectIntoAgents: next } });
    },
    [mutation],
  );
  return (
    <ToggleRowView
      title={t("settings.host.orchestration.enableTools.title")}
      description={t("settings.host.orchestration.enableTools.hint")}
      value={enabled}
      onValueChange={onValueChange}
      disabled={mutation.isPending}
      errorText={toErrorMessage(mutation.error)}
      withBorder={false}
      accessibilityLabel={t("settings.host.orchestration.enableTools.accessibilityLabel")}
      testID="host-page-inject-mcp-card"
    />
  );
}

// The Browser Tools master row: browserTools.enabled, a security opt-in for
// agent access to Otto browser tabs (and the functional gate over the whole
// Preview subsystem). Off = both browser category rows below are inert.
function BrowserToolsMasterRow(props: { serverId: string; enabled: boolean; withBorder: boolean }) {
  const { serverId, enabled, withBorder } = props;
  const mutation = useToggleMutation(serverId);
  const onValueChange = useCallback(
    (next: boolean) => {
      mutation.mutate({ browserTools: { enabled: next } });
    },
    [mutation],
  );
  return (
    <ToggleRowView
      title={BROWSER_TOOLS_TITLE}
      description={BROWSER_TOOLS_WARNING}
      value={enabled}
      onValueChange={onValueChange}
      disabled={mutation.isPending}
      errorText={toErrorMessage(mutation.error)}
      withBorder={withBorder}
      accessibilityLabel="Enable browser tools"
      testID="host-page-browser-tools-card"
    />
  );
}

// The Otto Tools section: one grouped card, split-line rows, like every other
// settings section. The "Enable Otto tools" master sits above the core
// `mcp.toolGroups` category rows (browser/preview live in their own Browser
// Tools section). Visible whenever connected so the master shows on old daemons;
// the category rows only render where the per-group capability is present, and
// grey out when the master is off.
export function OttoToolsSection({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hasFeature = useMcpToolGroupsFeature(serverId);
  const { config } = useDaemonConfig(serverId);

  if (!isConnected) {
    return null;
  }

  const ottoEnabled = config?.mcp.injectIntoAgents !== false;

  return (
    <SettingsSection title="Otto Tools">
      <View style={settingsStyles.card}>
        <OttoToolsMasterRow serverId={serverId} enabled={ottoEnabled} />
        {hasFeature
          ? OTTO_CORE_TOOL_GROUP_META.map((meta) => (
              <ToolGroupToggleRow
                key={meta.group}
                serverId={serverId}
                config={config}
                meta={meta}
                masterEnabled={ottoEnabled}
              />
            ))
          : null}
      </View>
    </SettingsSection>
  );
}

// The Browser Tools section: its own grouped card after Otto Tools. The "Browser
// tools" master (a security opt-in for agent access to Otto browser tabs, and
// the functional gate over the whole Preview subsystem) sits above its two
// browser categories — Control and Preview. Rows grey out when the
// master is off.
export function BrowserToolsSection({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hasFeature = useMcpToolGroupsFeature(serverId);
  const { config } = useDaemonConfig(serverId);

  if (!isConnected) {
    return null;
  }

  const browserEnabled = config?.browserTools.enabled === true;

  return (
    <SettingsSection title="Browser Tools">
      <View style={settingsStyles.card}>
        <BrowserToolsMasterRow serverId={serverId} enabled={browserEnabled} withBorder={false} />
        {hasFeature
          ? BROWSER_TOOL_GROUP_META.map((meta) => (
              <ToolGroupToggleRow
                key={meta.group}
                serverId={serverId}
                config={config}
                meta={meta}
                masterEnabled={browserEnabled}
              />
            ))
          : null}
      </View>
    </SettingsSection>
  );
}

// The daemon-wide agent-behavior rows. Rendered inside the Agents section's
// grouped card (caller places them, each carries its own divider); hidden
// without the capability.
export function AgentBehaviorRows({ serverId }: { serverId: string }) {
  const hasFeature = useAgentBehaviorTogglesFeature(serverId);
  const { config } = useDaemonConfig(serverId);

  if (!hasFeature) {
    return null;
  }

  return (
    <>
      {AGENT_BEHAVIOR_META.map((meta) => (
        <AgentBehaviorToggleRow key={meta.key} serverId={serverId} config={config} meta={meta} />
      ))}
    </>
  );
}

// The metadata-generation master + writer-preference rows. Rendered inside the
// Agents section's grouped card; hidden without the capability.
export function MetadataGenerationRows({ serverId }: { serverId: string }) {
  const hasFeature = useMetadataGenerationEnabledFeature(serverId);
  const { config } = useDaemonConfig(serverId);

  if (!hasFeature) {
    return null;
  }

  return (
    <>
      <MetadataGenerationEnabledRow serverId={serverId} config={config} />
      <PreferWriterPersonalitiesRow serverId={serverId} config={config} />
    </>
  );
}
