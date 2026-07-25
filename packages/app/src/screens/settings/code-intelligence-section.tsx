import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import type {
  LspLanguageState,
  LspRunningServer,
  LspServersSnapshot,
} from "@otto-code/client/internal/daemon-client";
import { SettingsSection } from "./settings-section";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useToast } from "@/contexts/toast-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSolutionViewFeature } from "@/solution/use-solution-view-feature";
import { useWorkspace } from "@/stores/session-store-hooks";

/**
 * Daemon → Code. These are processes on the daemon's machine, so the settings follow
 * the host, not the client.
 *
 * The screen exists because a user who cannot turn this off does not get to decide
 * whether they want it. Each language row states its own index cost, and the running
 * table lets someone who suspects the daemon of hogging memory see exactly what is up
 * and stop it rather than guess.
 *
 * Availability is scoped to a workspace because it genuinely varies by one: a server
 * can sit in one project's `node_modules` and be absent from another's.
 */

const EMPTY_LANGUAGES: readonly LspLanguageState[] = [];
const EMPTY_RUNNING: readonly LspRunningServer[] = [];

function formatUptime(uptimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(uptimeMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function CodeIntelligenceSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  // The row is absent, not disabled, on a host that cannot serve the feature — there is nothing
  // for a switch to turn on.
  const solutionViewSupported = useSolutionViewFeature(serverId);

  const selection = useActiveWorkspaceSelection();
  const workspaceId = selection?.serverId === serverId ? selection.workspaceId : null;
  const workspace = useWorkspace(serverId, workspaceId ?? "");
  // The workspace root a language server is scoped to: its own directory for a
  // worktree/checkout, the project root for a plain directory workspace.
  const cwd = workspace?.workspaceDirectory ?? workspace?.projectRootPath ?? null;

  const serversQueryKey = useMemo(() => ["lsp", "servers", serverId, cwd], [serverId, cwd]);

  const servers = useFetchQuery<LspServersSnapshot>({
    queryKey: serversQueryKey,
    enabled: client !== null && cwd !== null,
    // A value, not a list, and short-lived: uptime and running state go stale the
    // moment you look away, and the screen refetches on every mutation anyway.
    dataShape: "value",
    staleTimeMs: 5000,
    queryFn: async () => {
      if (!client || cwd === null) {
        return { languages: [], running: [] };
      }
      return client.listLspServers(cwd);
    },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: serversQueryKey });
  }, [queryClient, serversQueryKey]);

  const setMasterEnabled = useCallback(
    (enabled: boolean) => {
      void patchConfig({ lsp: { enabled } })
        .then(refresh)
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
    },
    [patchConfig, refresh, toast],
  );

  const stopServer = useCallback(
    async (rootPath: string, id: string) => {
      if (!client) {
        return;
      }
      try {
        await client.stopLspServer(rootPath, id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [client, toast],
  );

  const setSolutionManagementEnabled = useCallback(
    (enabled: boolean) => {
      void patchConfig({ dotnetSolutionManagement: { enabled } }).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    },
    [patchConfig, toast],
  );

  const masterEnabled = config?.lsp?.enabled ?? true;
  // Defaults OFF, and reads off on any daemon that has never heard of the setting. A feature that
  // spawns a process and evaluates MSBuild is opted into.
  const solutionManagementEnabled = config?.dotnetSolutionManagement?.enabled === true;
  const languages = servers.data?.languages ?? EMPTY_LANGUAGES;
  const running = servers.data?.running ?? EMPTY_RUNNING;

  return (
    <>
      <SettingsSection title={t("settings.host.code.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row} testID="lsp-master-toggle">
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.host.code.enabled")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.host.code.enabledHint")}</Text>
            </View>
            <Switch
              value={masterEnabled}
              onValueChange={setMasterEnabled}
              accessibilityLabel={t("settings.host.code.enabled")}
              testID="lsp-master-toggle-switch"
            />
          </View>
          <SolutionManagementRow
            supported={solutionViewSupported}
            enabled={solutionManagementEnabled}
            onValueChange={setSolutionManagementEnabled}
          />
          {cwd === null ? (
            <Text style={EMPTY_WITH_BORDER}>{t("settings.host.code.needsWorkspace")}</Text>
          ) : null}
        </View>
      </SettingsSection>

      {cwd === null ? null : (
        <>
          <LanguageRows
            serverId={serverId}
            languages={languages}
            masterEnabled={masterEnabled}
            onChanged={refresh}
          />
          <RunningServersTable running={running} onStopped={refresh} stop={stopServer} />
        </>
      )}
    </>
  );
}

/**
 * "Microsoft .NET Solution Management" — a **separate row** from code intelligence, not a member
 * of it.
 *
 * Turning C# language-server support off does not turn this off and vice versa. That is not a
 * stylistic choice: the Language Server Protocol has no project-structure request, so the Solution
 * view builds its own model and shares nothing with the rows below except a language. Nesting it
 * under the master switch would assert a dependency that does not exist.
 *
 * Absent, not disabled, on a host that cannot serve it — there is nothing for a switch to do.
 */
function SolutionManagementRow(props: {
  supported: boolean;
  enabled: boolean;
  onValueChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();

  if (!props.supported) {
    return null;
  }
  return (
    <View style={ROW_WITH_BORDER} testID="dotnet-solution-toggle">
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.host.code.solution")}</Text>
        <Text style={settingsStyles.rowHint}>{t("settings.host.code.solutionHint")}</Text>
      </View>
      <Switch
        value={props.enabled}
        onValueChange={props.onValueChange}
        accessibilityLabel={t("settings.host.code.solution")}
        testID="dotnet-solution-toggle-switch"
      />
    </View>
  );
}

function LanguageRows(props: {
  serverId: string;
  languages: readonly LspLanguageState[];
  masterEnabled: boolean;
  onChanged: () => void;
}) {
  const { serverId, languages, masterEnabled, onChanged } = props;
  const { t } = useTranslation();
  const toast = useToast();
  const { patchConfig } = useDaemonConfig(serverId);

  const setLanguageEnabled = useCallback(
    (id: string, enabled: boolean) => {
      void patchConfig({ lsp: { languages: { [id]: enabled } } })
        .then(onChanged)
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
    },
    [onChanged, patchConfig, toast],
  );

  return (
    <SettingsSection title={t("settings.host.code.languages")}>
      <View style={settingsStyles.card}>
        {languages.length === 0 ? (
          <Text style={styles.emptyRow}>{t("settings.host.code.noLanguages")}</Text>
        ) : (
          languages.map((language, index) => (
            <LanguageRow
              key={language.id}
              language={language}
              disabled={!masterEnabled}
              withBorder={index > 0}
              onValueChange={setLanguageEnabled}
            />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function LanguageRow(props: {
  language: LspLanguageState;
  disabled: boolean;
  withBorder: boolean;
  onValueChange: (id: string, enabled: boolean) => void;
}) {
  const { language, disabled, withBorder, onValueChange } = props;
  const { t } = useTranslation();
  const handleChange = useCallback(
    (next: boolean) => onValueChange(language.id, next),
    [language.id, onValueChange],
  );

  return (
    <View
      style={withBorder ? ROW_WITH_BORDER : settingsStyles.row}
      testID={`lsp-language-${language.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{language.id}</Text>
        <Text style={settingsStyles.rowHint}>
          {language.installed
            ? t("settings.host.code.installed", {
                bin: language.bin,
                rung: language.rung ?? "",
              })
            : t("settings.host.code.notInstalled", { bin: language.bin })}
        </Text>
        <Text style={styles.cost}>{language.indexCost}</Text>
      </View>
      <Switch
        value={language.enabled}
        disabled={disabled}
        onValueChange={handleChange}
        accessibilityLabel={language.id}
        testID={`lsp-language-${language.id}-switch`}
      />
    </View>
  );
}

function RunningServersTable(props: {
  running: readonly LspRunningServer[];
  stop: (rootPath: string, serverId: string) => Promise<void>;
  onStopped: () => void;
}) {
  const { running, stop, onStopped } = props;
  const { t } = useTranslation();

  return (
    <SettingsSection title={t("settings.host.code.running")}>
      <View style={settingsStyles.card}>
        {running.length === 0 ? (
          <Text style={styles.emptyRow}>{t("settings.host.code.noneRunning")}</Text>
        ) : (
          <View testID="lsp-running-table">
            <View style={styles.tableRow}>
              <Text style={HEADER_SERVER}>{t("settings.host.code.columnServer")}</Text>
              <Text style={HEADER_WORKSPACE}>{t("settings.host.code.columnWorkspace")}</Text>
              <Text style={HEADER_UPTIME}>{t("settings.host.code.columnUptime")}</Text>
              <View style={styles.cellAction} />
            </View>
            {running.map((entry) => (
              <RunningServerRow
                key={`${entry.rootPath}:${entry.serverId}`}
                entry={entry}
                stop={stop}
                onStopped={onStopped}
              />
            ))}
          </View>
        )}
      </View>
    </SettingsSection>
  );
}

function RunningServerRow(props: {
  entry: LspRunningServer;
  stop: (rootPath: string, serverId: string) => Promise<void>;
  onStopped: () => void;
}) {
  const { entry, stop, onStopped } = props;
  const { t } = useTranslation();
  const handleStop = useCallback(() => {
    void stop(entry.rootPath, entry.serverId).then(onStopped);
  }, [entry.rootPath, entry.serverId, onStopped, stop]);

  return (
    <View style={TABLE_ROW_WITH_BORDER}>
      <Text style={CELL_SERVER}>{entry.serverId}</Text>
      <Text style={CELL_WORKSPACE} numberOfLines={1} ellipsizeMode="head">
        {entry.rootPath}
      </Text>
      <Text style={CELL_UPTIME}>{formatUptime(entry.uptimeMs)}</Text>
      <View style={styles.cellAction}>
        <Button
          variant="secondary"
          size="sm"
          onPress={handleStop}
          testID={`lsp-stop-${entry.serverId}`}
        >
          {t("settings.host.code.stop")}
        </Button>
      </View>
    </View>
  );
}

const ROW_WITH_BORDER = [settingsStyles.row, settingsStyles.rowBorder];

const styles = StyleSheet.create((theme) => ({
  cost: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontStyle: "italic",
  },
  // Empty/unavailable copy stands in for a row inside a card, so it carries the
  // same padding a real row would rather than sitting flush against the border.
  emptyRow: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.xs + 2,
      md: theme.fontSize.xs,
    },
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  // Table rows live inside a card, so they take the card's horizontal padding
  // and separate with a top border — a bottom border on the last row would
  // double up against the card edge.
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  tableRowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  headerCell: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  cell: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  cellServer: {
    width: 110,
  },
  cellWorkspace: {
    flex: 1,
  },
  cellUptime: {
    width: 70,
    fontVariant: ["tabular-nums"],
  },
  cellAction: {
    width: 72,
    alignItems: "flex-end",
  },
}));

const TABLE_ROW_WITH_BORDER = [styles.tableRow, styles.tableRowBorder];
const EMPTY_WITH_BORDER = [styles.emptyRow, settingsStyles.rowBorder];
const HEADER_SERVER = [styles.headerCell, styles.cellServer];
const HEADER_WORKSPACE = [styles.headerCell, styles.cellWorkspace];
const HEADER_UPTIME = [styles.headerCell, styles.cellUptime];
const CELL_SERVER = [styles.cell, styles.cellServer];
const CELL_WORKSPACE = [styles.cell, styles.cellWorkspace];
const CELL_UPTIME = [styles.cell, styles.cellUptime];
