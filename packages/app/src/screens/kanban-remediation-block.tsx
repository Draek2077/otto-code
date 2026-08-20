import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import type { KanbanRemediation } from "@otto-code/protocol/kanban";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { resolveRunInTerminalOutcome } from "@/terminal/run-in-terminal-outcome";

/**
 * The recovery route for a Kanban failure the daemon knows how to fix.
 *
 * Same contract as the LSP install block: the daemon resolved the command, so
 * the client only displays, copies, or runs it, and running it always passes
 * through a confirm dialog showing the literal text. Nothing is spawned while
 * the user's back is turned.
 *
 * Running it does not stop at spawning. The command is a device-flow sign-in:
 * it prints a one-time code, waits for Enter, then opens the browser, so a
 * terminal the user cannot see is no better than no terminal at all. The
 * shared outcome resolver sends the user to the project's workspace with that
 * terminal focused.
 */
export function KanbanRemediationBlock({
  serverId,
  cwd,
  remediation,
}: {
  serverId: string;
  cwd: string | null;
  remediation: KanbanRemediation;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const client = useHostRuntimeClient(serverId);
  const hostConnected = useHostRuntimeIsConnected(serverId);
  const commandText = remediation.steps.map((step) => step.display).join("\n");

  const copyCommand = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(commandText);
      // `copied(label)` renders "Copied: {label}" - the key is a short noun.
      toast.copied(t("kanban.remediation.copied"));
    } catch {
      toast.error(t("kanban.remediation.copyFailed"));
    }
  }, [commandText, t, toast]);

  const runInTerminal = useCallback(async () => {
    const first = remediation.steps[0];
    if (!client || !hostConnected || !cwd || !first) {
      return;
    }
    const confirmed = await confirmDialog({
      title: t("kanban.remediation.runTitle"),
      message: t("kanban.remediation.runMessage", { command: commandText }),
      confirmLabel: t("kanban.remediation.runConfirm"),
      cancelLabel: t("kanban.remediation.runCancel"),
    });
    if (!confirmed) {
      return;
    }
    try {
      // A real argv, never a shell string. The workspace binding is left to the
      // daemon, which resolves it from the cwd.
      const result = await client.createTerminal(
        cwd,
        t("kanban.remediation.terminalTitle"),
        undefined,
        {
          command: first.command,
          args: [...first.args],
        },
      );
      const outcome = resolveRunInTerminalOutcome({
        serverId,
        terminal: result.terminal,
        error: result.error,
      });
      if (outcome.kind === "error") {
        toast.error(outcome.message ?? t("kanban.remediation.terminalFailed"));
        return;
      }
      if (outcome.kind === "started") {
        toast.show(t("kanban.remediation.terminalStarted"), { variant: "success" });
        return;
      }
      router.navigate(outcome.route);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [client, hostConnected, cwd, remediation.steps, commandText, router, serverId, t, toast]);

  if (remediation.steps.length === 0) {
    return null;
  }

  return (
    <View style={styles.block} testID="kanban-remediation">
      <Text style={styles.command} numberOfLines={2} ellipsizeMode="middle">
        {commandText}
      </Text>
      <View style={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          onPress={copyCommand}
          testID="kanban-remediation-copy"
        >
          {t("kanban.remediation.copy")}
        </Button>
        {client && hostConnected && cwd ? (
          <Button variant="ghost" size="sm" onPress={runInTerminal} testID="kanban-remediation-run">
            {t("kanban.remediation.run")}
          </Button>
        ) : null}
      </View>
      <Text style={styles.hint}>{t("kanban.remediation.hint")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: {
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
    maxWidth: 520,
  },
  // Code surface, code font size (docs/design.md): a command the user is about
  // to run reads as code, not as body copy.
  command: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    backgroundColor: theme.colors.surfaceCode,
    borderRadius: theme.borderRadius.base,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "center",
    maxWidth: 360,
  },
}));
