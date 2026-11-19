import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";

export function ObservedSubagentControls({
  serverId,
  workspaceId,
  parentId,
  subagentId,
  descriptor,
}: {
  serverId: string;
  workspaceId: string;
  parentId: string;
  subagentId: string;
  descriptor: { provider: string; status: string } | null;
}) {
  const client = useHostRuntimeClient(serverId);
  // COMPAT(ottoObservedSubagentStop): added in v0.10.0, review after 2027-05-19.
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.ottoObservedSubagentStop === true,
  );
  const canStop = supported && descriptor?.provider === "claude" && descriptor.status === "running";
  const toast = useToast();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const stop = useCallback(async () => {
    if (!canStop || !client || lock.current || requested) return;
    lock.current = true;
    setPending(true);
    try {
      if (
        !(await confirmDialog({
          title: "Stop this subagent?",
          message: "The parent chat will keep running.",
          confirmLabel: "Stop subagent",
          destructive: true,
        }))
      )
        return;
      await client.invokePluginRpc("otto-observed-subagents", "subagent.stop", {
        parentId,
        subagentId,
        workspaceId,
      });
      setRequested(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not stop this subagent.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }, [canStop, client, parentId, requested, subagentId, toast, workspaceId]);
  return (
    <View style={styles.row}>
      <Text style={styles.label}>Provider-managed subagent · Read only</Text>
      {canStop && client ? (
        <Button variant="secondary" size="sm" disabled={pending || requested} onPress={stop}>
          {requested ? "Stop requested" : "Stop subagent"}
        </Button>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  row: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  label: { flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
