import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { TerminalPane } from "@/components/terminal-pane";
import {
  resolveExternalEditorCapability,
  resolveExternalFileEditorCommand,
  type FileEditorMode,
} from "@/editor/external-file-editor";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { revealFileInFiles } from "@/git/changes-reveal";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";

export interface ExternalFileEditorPaneProps {
  serverId: string;
  workspaceId: string;
  workspaceRoot: string;
  path: string;
  mode: FileEditorMode;
  customCommand: string;
  onExit: (reason?: string) => void;
  onLaunchFailure: (message: string) => void;
}

function resolveFileEditorName(mode: FileEditorMode): string {
  switch (mode) {
    case "vim":
      return "Vim";
    case "neovim":
      return "Neovim";
    case "custom":
      return "File editor";
    case "off":
      return "File editor";
  }
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/u).findLast(Boolean) ?? path;
}

function ExternalFileEditorNotice({
  fileState,
  editorName,
}: {
  fileState: "clean" | "changed" | "deleted";
  editorName: string;
}) {
  if (fileState === "deleted") {
    return (
      <Text style={styles.warning} testID="external-file-editor-file-deleted">
        The file was deleted on disk. Save it from {editorName} to recreate it.
      </Text>
    );
  }
  if (fileState === "changed") {
    return (
      <Text style={styles.notice} testID="external-file-editor-file-changed">
        {editorName} changed this file. Otto will reload it after you quit.
      </Text>
    );
  }
  return null;
}

/**
 * The selected file editor owns the file while this component is mounted. The
 * CodeMirror editor is deliberately not rendered alongside it, so its draft,
 * autosave, conflict prompts, and document mirror cannot compete with Vim.
 */
export function ExternalFileEditorPane({
  serverId,
  workspaceId,
  workspaceRoot,
  path,
  mode,
  customCommand,
  onExit,
  onLaunchFailure,
}: ExternalFileEditorPaneProps) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { isWorkspaceFocused, isPaneFocused } = usePaneFocus();
  const { openFileInWorkspace } = usePaneContext();
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [fileState, setFileState] = useState<"clean" | "changed" | "deleted">("clean");
  const terminalIdRef = useRef<string | null>(null);
  const editorName = resolveFileEditorName(mode);
  const terminalTitle = `${editorName}: ${fileNameFromPath(path)}`;

  useEffect(() => {
    if (terminalIdRef.current) {
      return;
    }
    if (!client || !isConnected) {
      onLaunchFailure("The Otto host is not connected. Reconnect the host and try again.");
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        if (mode === "vim" || mode === "neovim") {
          const diagnostic = await client.runTerminalCompatibilityDiagnostic();
          const capabilityError = resolveExternalEditorCapability(diagnostic, mode);
          if (capabilityError) {
            throw new Error(capabilityError);
          }
        }
        const editorCommand = resolveExternalFileEditorCommand({
          mode,
          customCommand,
          path,
        });
        if (!editorCommand) {
          throw new Error("Set a custom file editor command before opening this file.");
        }
        const result = await client.createTerminal(
          workspaceRoot,
          `${editorName}: ${path}`,
          undefined,
          {
            command: editorCommand.command,
            args: editorCommand.args,
            workspaceId,
            presentation: "embedded",
          },
        );
        if (cancelled) {
          if (result.terminal) {
            await client.killTerminal(result.terminal.id).catch(() => undefined);
          }
          return;
        }
        if (!result.terminal) {
          throw new Error(result.error ?? "The file editor could not be started.");
        }
        // Vim owns its internal status and command UI, but its OSC window
        // title is not a useful Otto workspace-tab label. Pin a clear title
        // for this dedicated File Editor terminal instead.
        await client
          .renameTerminal({
            terminalId: result.terminal.id,
            title: terminalTitle,
          })
          .catch(() => undefined);
        if (cancelled) {
          await client.killTerminal(result.terminal.id).catch(() => undefined);
          return;
        }
        terminalIdRef.current = result.terminal.id;
        setTerminalId(result.terminal.id);
      } catch (error) {
        if (!cancelled) {
          onLaunchFailure(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    client,
    customCommand,
    editorName,
    isConnected,
    mode,
    onLaunchFailure,
    path,
    serverId,
    terminalTitle,
    workspaceId,
    workspaceRoot,
  ]);

  useEffect(() => {
    return () => {
      const id = terminalIdRef.current;
      if (id && client) {
        void client.killTerminal(id).catch(() => undefined);
      }
      terminalIdRef.current = null;
    };
  }, [client, serverId, workspaceId]);

  useEffect(() => {
    if (!client || !terminalId) {
      return;
    }
    let cancelled = false;
    const checkTerminal = async () => {
      const result = await client
        .listTerminals(workspaceRoot, undefined, { workspaceId })
        .catch(() => null);
      if (
        !cancelled &&
        result &&
        !result.terminals.some((terminal) => terminal.id === terminalId)
      ) {
        onExit();
      }
    };
    void checkTerminal();
    const poll = setInterval(() => void checkTerminal(), 1_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [client, onExit, terminalId, workspaceId, workspaceRoot]);

  useEffect(() => {
    if (!client) {
      return;
    }
    return client.watchFile(workspaceRoot, path, (event) => {
      setFileState(event.change === "deleted" ? "deleted" : "changed");
    });
  }, [client, path, workspaceRoot]);

  useEffect(() => {
    if (!client || !terminalId) {
      return;
    }
    const stopExit = client.on("terminal_stream_exit", (message) => {
      if (message.payload.terminalId === terminalId) {
        onExit();
      }
    });
    const stopSnapshot = client.on("terminals_changed", (message) => {
      if (message.payload.cwd !== workspaceRoot) {
        return;
      }
      if (!message.payload.terminals.some((terminal) => terminal.id === terminalId)) {
        onExit();
      }
    });
    return () => {
      stopExit();
      stopSnapshot();
    };
  }, [client, onExit, terminalId, workspaceRoot]);

  const handleOpenFileExplorer = useCallback(() => {
    revealFileInFiles({ serverId, cwd: workspaceRoot, path, isGit: false });
  }, [path, serverId, workspaceRoot]);
  const handleNavigateToFolder = useCallback(
    (folderPath: string) => {
      revealFileInFiles({ serverId, cwd: workspaceRoot, path: folderPath, isGit: false });
    },
    [serverId, workspaceRoot],
  );
  const handleOpenWorkspaceFile = useCallback(
    (request: WorkspaceFileOpenRequest) => openFileInWorkspace(request),
    [openFileInWorkspace],
  );
  return (
    <View style={styles.container} testID="external-file-editor-pane">
      <ExternalFileEditorNotice fileState={fileState} editorName={editorName} />
      {terminalId ? (
        <TerminalPane
          serverId={serverId}
          cwd={workspaceRoot}
          terminalId={terminalId}
          isWorkspaceFocused={isWorkspaceFocused}
          isPaneFocused={isPaneFocused}
          onOpenFileExplorer={handleOpenFileExplorer}
          onNavigateToFolder={handleNavigateToFolder}
          onOpenWorkspaceFile={handleOpenWorkspaceFile}
        />
      ) : (
        <View style={styles.launching}>
          <LoadingSpinner />
          <Text style={styles.detail}>Starting {editorName}…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  notice: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.statusWarningSurface,
    fontSize: theme.fontSize.xs,
  },
  warning: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    color: theme.colors.statusDanger,
    backgroundColor: theme.colors.statusDangerSurface,
    fontSize: theme.fontSize.xs,
  },
  launching: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
}));
