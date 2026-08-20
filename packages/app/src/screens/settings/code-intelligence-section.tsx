import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import type {
  LspLanguageState,
  LspRunningServer,
  LspServersSnapshot,
} from "@otto-code/client/internal/daemon-client";
import { SettingsSection } from "./settings-section";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useToast } from "@/contexts/toast-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSolutionViewFeature } from "@/solution/use-solution-view-feature";
import { useLspHostServersFeature } from "./use-lsp-host-servers-feature";
import * as Clipboard from "expo-clipboard";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { confirmDialog } from "@/utils/confirm-dialog";

/**
 * Daemon → Code. These are processes on the daemon's machine, so the settings follow
 * the host, not the client.
 *
 * The screen exists because a user who cannot turn this off does not get to decide
 * whether they want it. Each language row states its own index cost, and the running
 * table lets someone who suspects the daemon of hogging memory see exactly what is up
 * and stop it rather than guess.
 *
 * The list is host-wide and unconditional: every language server this daemon knows how to
 * run, the toolchain behind it, and whether this machine can supply it. Settings has no
 * workspace in hand and should not need one to state a machine's capabilities. The one
 * genuinely per-project fact, a server living in a project's own `node_modules/.bin`, is
 * reported as such on the row instead of gating the whole screen behind an open workspace.
 */

const EMPTY_LANGUAGES: readonly LspLanguageState[] = [];
const EMPTY_RUNNING: readonly LspRunningServer[] = [];

/**
 * The discovery rung a server can only ever come from the open project. The daemon sends
 * raw rung names, and this is the one the screen has to reason about: a row with no other
 * rung is not missing from the host, it is supplied by whatever project uses it.
 */
const PROJECT_RUNG = "workspaceBin";

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

  // The row is absent, not disabled, on a host that cannot serve the feature - there is nothing
  // for a switch to turn on.
  const solutionViewSupported = useSolutionViewFeature(serverId);
  // The host-wide listing is the only listing. An older daemon demands a cwd, and probing
  // another machine's PATH from here is not a thing a client can do, so the screen says so
  // rather than showing rows it cannot fill.
  const hostServersSupported = useLspHostServersFeature(serverId);

  const serversQueryKey = useMemo(() => ["lsp", "servers", serverId], [serverId]);

  const servers = useFetchQuery<LspServersSnapshot>({
    queryKey: serversQueryKey,
    enabled: client !== null && hostServersSupported,
    // A value, not a list, and short-lived: uptime and running state go stale the
    // moment you look away, and the screen refetches on every mutation anyway.
    dataShape: "value",
    staleTimeMs: 5000,
    queryFn: async () => {
      if (!client) {
        return { languages: [], running: [] };
      }
      return client.listLspServers();
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

  const setCsharpProjectScope = useCallback(
    (csharpProjectScope: "solution" | "allProjects") => {
      void patchConfig({ lsp: { csharpProjectScope } })
        .then(refresh)
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
    },
    [patchConfig, refresh, toast],
  );

  const masterEnabled = config?.lsp?.enabled ?? true;
  // Absent means "solution" - the wire field carries no default so an unrelated `lsp` patch
  // cannot reset it (see the protocol schema), which leaves the fallback to be stated here.
  const csharpProjectScope = config?.lsp?.csharpProjectScope ?? "solution";
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
          <CsharpProjectScopeRow
            disabled={!masterEnabled}
            value={csharpProjectScope}
            onValueChange={setCsharpProjectScope}
          />
          <SolutionManagementRow
            supported={solutionViewSupported}
            enabled={solutionManagementEnabled}
            onValueChange={setSolutionManagementEnabled}
          />
          {hostServersSupported ? null : (
            <Text style={EMPTY_WITH_BORDER}>{t("settings.host.code.needsHostUpdate")}</Text>
          )}
        </View>
      </SettingsSection>

      {hostServersSupported ? (
        <>
          <LanguageRows
            serverId={serverId}
            languages={languages}
            masterEnabled={masterEnabled}
            onChanged={refresh}
          />
          <RunningServersTable running={running} onStopped={refresh} stop={stopServer} />
        </>
      ) : null}
    </>
  );
}

/**
 * "Microsoft .NET Solution Management" - a **separate row** from code intelligence, not a member
 * of it.
 *
 * Turning C# language-server support off does not turn this off and vice versa. That is not a
 * stylistic choice: the Language Server Protocol has no project-structure request, so the Solution
 * view builds its own model and shares nothing with the rows below except a language. Nesting it
 * under the master switch would assert a dependency that does not exist.
 *
 * Absent, not disabled, on a host that cannot serve it - there is nothing for a switch to do.
 */
/**
 * Which workspace the C# server loads, host-wide.
 *
 * A segmented control rather than a switch because neither option is "off": both load C#, they
 * trade coverage against time. `allProjects` is csharp-ls's own glob mode, which is complete but
 * loads each project separately, so the hint has to say so - a user picking it on a large
 * repository is opting into minutes of indexing, and that must not be a surprise.
 */
function CsharpProjectScopeRow(props: {
  disabled: boolean;
  value: "solution" | "allProjects";
  onValueChange: (value: "solution" | "allProjects") => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={ROW_WITH_BORDER} testID="lsp-csharp-scope">
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.host.code.csharpScope")}</Text>
        <Text style={settingsStyles.rowHint}>{t("settings.host.code.csharpScopeHint")}</Text>
      </View>
      <SegmentedControl
        options={[
          {
            value: "solution",
            label: t("settings.host.code.csharpScopeSolution"),
            disabled: props.disabled,
            testID: "lsp-csharp-scope-solution",
          },
          {
            value: "allProjects",
            label: t("settings.host.code.csharpScopeAllProjects"),
            disabled: props.disabled,
            testID: "lsp-csharp-scope-all",
          },
        ]}
        value={props.value}
        onValueChange={props.onValueChange}
        testID="lsp-csharp-scope-control"
      />
    </View>
  );
}

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
              serverId={serverId}
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
  serverId: string;
  onValueChange: (id: string, enabled: boolean) => void;
}) {
  const { language, disabled, withBorder, serverId, onValueChange } = props;
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
        <Text style={settingsStyles.rowHint}>{describeAvailability(language, t)}</Text>
        {/* The resolved binary, so "found" names the toolchain it found rather than
            asserting it. Absent when nothing resolved, since there is no path to show. */}
        {language.path ? (
          <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
            {language.path}
          </Text>
        ) : null}
        <Text style={styles.cost}>{language.indexCost}</Text>
        {language.installed ||
        language.install === undefined ||
        language.install === null ? null : (
          <LspInstallBlock
            id={language.id}
            serverId={serverId}
            install={language.install}
            disabled={disabled}
          />
        )}
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

/**
 * The "how to install this" block, shown only for a missing, host-installable server.
 *
 * The daemon has already resolved the platform logic and sent finished steps, so the client
 * only ever displays and copies - it never assembles a command. Copy is primary; Run in
 * terminal is secondary and MUST pass through a confirm dialog that shows the exact command
 * before anything is spawned. A manual route has no command, so it offers only the link.
 */
function LspInstallBlock(props: {
  id: string;
  serverId: string;
  install: NonNullable<LspLanguageState["install"]>;
  disabled: boolean;
}) {
  const { id, serverId, install, disabled } = props;
  const { t } = useTranslation();
  const toast = useToast();

  // "Run in terminal" needs a daemon and a directory to run in: the host must be connected,
  // and the terminal opens in the user's last workspace on this host (a host screen has no
  // other directory to offer). A last selection that belongs to another host is not a
  // directory on this one, so it does not count. Without either, the button is absent
  // rather than a dead end - copying the command still works.
  const lastWorkspace = useLastWorkspaceSelection();
  const onThisHost = lastWorkspace?.serverId === serverId;
  const hostConnected = useHostRuntimeIsConnected(serverId);
  // The terminal subsystem is keyed on the workspace's own opaque id (the descriptor's `id`),
  // so read the whole descriptor rather than just its directory.
  const lastWorkspaceDescriptor = useWorkspace(
    onThisHost ? serverId : null,
    onThisHost ? (lastWorkspace?.workspaceId ?? null) : null,
  );
  const runCwd = lastWorkspaceDescriptor?.workspaceDirectory ?? null;
  const runWorkspaceId = lastWorkspaceDescriptor?.id ?? null;
  const client = useHostRuntimeClient(serverId);

  const copyCommand = useCallback(async () => {
    const text = install.steps.map((step) => step.display).join("\n");
    try {
      await Clipboard.setStringAsync(text);
      // `copied(label)` renders "Copied: {label}" - the key is a short noun, not a sentence.
      toast.copied(t("settings.host.code.install.copied"));
    } catch {
      toast.error(t("settings.host.code.install.copyFailed"));
    }
  }, [install.steps, t, toast]);

  const runInTerminal = useCallback(async () => {
    if (!client || !hostConnected || !runCwd) {
      return;
    }
    // The exact command is shown before anything runs; the user confirms the literal text.
    const confirmed = await confirmDialog({
      title: t("settings.host.code.install.runTitle"),
      message: t("settings.host.code.install.runMessage", {
        command: install.steps.map((step) => step.display).join("\n"),
      }),
      confirmLabel: t("settings.host.code.install.runConfirm"),
      cancelLabel: t("settings.host.code.install.runCancel"),
    });
    if (!confirmed) {
      return;
    }
    const first = install.steps[0];
    if (!first) {
      return;
    }
    try {
      // A real argv, never a shell string: the daemon runs the first step as-is. The
      // confirm dialog already showed every step, so a two-step install (SDK then tool)
      // leaves the user in the terminal to run the second line once the first succeeds.
      const result = await client.createTerminal(
        runCwd,
        t("settings.host.code.install.terminalTitle", { id }),
        undefined,
        {
          command: first.command,
          args: [...first.args],
          workspaceId: runWorkspaceId ?? undefined,
        },
      );
      if (!result.terminal && result.error) {
        toast.error(result.error);
        return;
      }
      toast.show(t("settings.host.code.install.terminalStarted"), { variant: "success" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [client, hostConnected, runCwd, runWorkspaceId, id, install.steps, t, toast]);

  // A manual route is a link, not a command - no copy, no terminal, nothing to confirm.
  if (install.steps.length === 0) {
    return (
      <View style={styles.installBlock} testID={`lsp-language-${id}-install`}>
        <Text style={styles.installUrl} numberOfLines={1} ellipsizeMode="middle">
          {install.url ?? ""}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.installBlock} testID={`lsp-language-${id}-install`}>
      {install.steps.map((step) => (
        <View key={step.display} style={styles.installStep}>
          <Text style={styles.installCommand} numberOfLines={1} ellipsizeMode="middle">
            {step.display}
          </Text>
          {step.note ? (
            <Text style={styles.installNote} numberOfLines={2}>
              {step.note}
            </Text>
          ) : null}
        </View>
      ))}
      <View style={styles.installActions}>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onPress={copyCommand}
          testID={`lsp-language-${id}-install-copy`}
        >
          {t("settings.host.code.install.copy")}
        </Button>
        {client && hostConnected && runCwd ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onPress={runInTerminal}
            testID={`lsp-language-${id}-install-run`}
          >
            {t("settings.host.code.install.run")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Three answers, not two. "Not installed" is a lie for a row whose only source is the
 * project's own `node_modules/.bin`: the host is never going to have it, and nothing is
 * wrong. Older daemons send no `discovery`, in which case the two-state answer is all
 * there is to say.
 */
function describeAvailability(language: LspLanguageState, t: TFunction): string {
  if (language.installed) {
    return t("settings.host.code.installed", {
      bin: language.bin,
      rung: t(`settings.host.code.rung.${language.rung ?? "unknown"}`, {
        defaultValue: language.rung ?? "",
      }),
    });
  }
  const projectOnly =
    language.discovery !== undefined &&
    language.discovery.length > 0 &&
    language.discovery.every((rung) => rung === PROJECT_RUNG);
  return projectOnly
    ? t("settings.host.code.projectSupplied", { bin: language.bin })
    : t("settings.host.code.notInstalled", { bin: language.bin });
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
              {/* The directory a running server was started against, which is a fact about
                  the process, not a workspace this screen knows or needs. */}
              <Text style={HEADER_ROOT}>{t("settings.host.code.columnRoot")}</Text>
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
      <Text style={CELL_ROOT} numberOfLines={1} ellipsizeMode="head">
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
  // A resolved executable is a code surface, so it takes the Code font and its size
  // setting rather than a body size that ignores both.
  path: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  cost: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontStyle: "italic",
  },
  // The install block sits under the hint inside the row's label column: a command is a
  // code surface, so it takes the Code font, and the actions stay a single compact row so
  // a row with an install command does not grow the card.
  installBlock: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[2],
  },
  installStep: {
    gap: theme.spacing[1],
  },
  installCommand: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  installNote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  installUrl: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.xs,
  },
  installActions: {
    flexDirection: "row",
    gap: theme.spacing[2],
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
  // and separate with a top border - a bottom border on the last row would
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
  cellRoot: {
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
const HEADER_ROOT = [styles.headerCell, styles.cellRoot];
const HEADER_UPTIME = [styles.headerCell, styles.cellUptime];
const CELL_SERVER = [styles.cell, styles.cellServer];
const CELL_ROOT = [styles.cell, styles.cellRoot];
const CELL_UPTIME = [styles.cell, styles.cellUptime];
