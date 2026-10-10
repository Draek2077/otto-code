import { useCallback } from "react";
import { StyleSheet } from "react-native-unistyles";
import { View } from "react-native";
import { getOttoToolLeafName } from "@otto-code/protocol/tool-name-normalization";
import { Network } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { useRuns } from "@/hooks/use-runs";
import { useOptionalPaneContext } from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import { openWorkflowRunTab, resolveWorkflowWorkspaceId } from "@/workflows/open-workflow-run";

const RUN_ID_PATTERN = /\brun_[a-z0-9]+_[0-9a-f]+\b/;

// The result reaches the client in whatever envelope the provider used (plain
// text, the MCP structuredContent object, or a wrapper around it), and run ids
// have one fixed shape, so the id is matched rather than walked to.
function readRunId(output: unknown): string | null {
  if (output === null || output === undefined) {
    return null;
  }
  let text: string;
  try {
    text = typeof output === "string" ? output : JSON.stringify(output);
  } catch {
    return null;
  }
  return RUN_ID_PATTERN.exec(text)?.[0] ?? null;
}

/**
 * The run a `start_workflow` call declared, read from its result. Null for any
 * other tool, and while the call has not returned.
 */
export function readStartedWorkflowRunId(
  toolName: string | undefined,
  output: unknown,
): string | null {
  if (!toolName || getOttoToolLeafName(toolName) !== "start_workflow") {
    return null;
  }
  return readRunId(output);
}

/**
 * "Open workflow" on the tool call that started a run: the conductor's own
 * transcript is the list of every Workflow it ran, in order, so each call links
 * to its run. Renders nothing outside a pane (no workspace to open into) or
 * when the run is not on this host any more.
 */
export function WorkflowToolLink({ runId }: { runId: string }) {
  const pane = useOptionalPaneContext();
  const serverId = pane?.serverId ?? null;
  const runsQuery = useRuns(serverId);
  const workspaces = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.workspaces : undefined,
  );
  const run = (runsQuery.data ?? []).find((candidate) => candidate.id === runId) ?? null;
  const workspaceId = run ? resolveWorkflowWorkspaceId(run, workspaces) : null;
  const open = useCallback(() => {
    if (serverId && workspaceId) {
      openWorkflowRunTab({ serverId, workspaceId, runId });
    }
  }, [serverId, workspaceId, runId]);
  if (!serverId || !workspaceId) {
    return null;
  }
  return (
    <View style={styles.row}>
      <Button
        variant="outline"
        size="sm"
        leftIcon={Network}
        onPress={open}
        testID={`workflow-tool-open-${runId}`}
      >
        Open workflow
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
}));
