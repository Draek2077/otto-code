import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import { KeyboardTranslateView } from "@/components/keyboard-translate-view";
import { Button } from "@/components/ui/button";
import { FOOTER_HEIGHT } from "@/constants/layout";
import { useRuns } from "@/hooks/use-runs";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { openWorkflowRunTab, resolveWorkflowWorkspaceId } from "@/workflows/open-workflow-run";

interface WorkflowWorkerCalloutProps {
  serverId: string;
  runId: string;
}

/**
 * Composer replacement for a chat a Workflow spawned. The run drives it - it
 * sends the judge's feedback, awaits the answer, and archives the chat when the
 * run settles - so a user message would land in a turn the run is not waiting
 * for and leave the run record describing a conversation that did not happen.
 * Read-only, with the way back to the run that explains it.
 */
export function WorkflowWorkerCallout({ serverId, runId }: WorkflowWorkerCalloutProps) {
  const insets = useSafeAreaInsets();
  const runsQuery = useRuns(serverId);
  const workspaces = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const run = (runsQuery.data ?? []).find((candidate) => candidate.id === runId) ?? null;
  const workspaceId = run ? resolveWorkflowWorkspaceId(run, workspaces) : null;

  const containerStyle = useMemo(
    () => [styles.container, { paddingBottom: insets.bottom }],
    [insets.bottom],
  );
  const openWorkflow = useCallback(() => {
    if (workspaceId) {
      openWorkflowRunTab({ serverId, workspaceId, runId, navigate: true });
    }
  }, [serverId, workspaceId, runId]);

  return (
    <KeyboardTranslateView style={containerStyle}>
      <View style={styles.inputAreaContainer}>
        <ChatWidthBounds style={styles.inputAreaContent}>
          <View style={styles.callout} testID="workflow-worker-callout">
            <View style={styles.textColumn}>
              <Text style={styles.title}>
                {run ? `Worked for the Workflow "${run.title}"` : "Worked for a Workflow"}
              </Text>
              <Text style={styles.subtitle}>
                Read-only. The Workflow sent this chat its work and read its answers.
              </Text>
            </View>
            {workspaceId ? (
              <Button
                size="sm"
                variant="secondary"
                onPress={openWorkflow}
                testID="workflow-worker-open-workflow"
              >
                Open workflow
              </Button>
            ) : null}
          </View>
        </ChatWidthBounds>
      </View>
    </KeyboardTranslateView>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flexDirection: "column",
    position: "relative",
  },
  inputAreaContainer: {
    position: "relative",
    minHeight: FOOTER_HEIGHT,
    marginHorizontal: "auto",
    alignItems: "center",
    width: "100%",
    overflow: "visible",
    padding: theme.spacing[4],
  },
  inputAreaContent: {
    width: "100%",
  },
  callout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    // Muted surface and no input affordance: the same read-only signal the
    // observed-subagent callout uses.
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius["2xl"],
    opacity: 0.85,
    paddingVertical: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingHorizontal: {
      xs: theme.spacing[4],
      md: theme.spacing[6],
    },
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
