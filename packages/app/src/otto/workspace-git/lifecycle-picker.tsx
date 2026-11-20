import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { create } from "zustand";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SettingsCard, SettingsRow } from "@/components/settings";
import {
  listReopenWorktrees,
  listWorkspaceMoveTargets,
  moveWorkspaceChat,
  reopenWorktree,
} from "@getpaseo/plugin/otto/workspace-git";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

interface Move {
  kind: "move";
  serverId: string;
  workspaceId: string;
  agentId: string;
  tabId: string;
}
interface Reopen {
  kind: "reopen";
  serverId: string;
  projectId: string;
}
type Request = Move | Reopen;
const usePicker = create<{ request: Request | null }>(() => ({ request: null }));
const close = () => usePicker.setState({ request: null });
export function openWorkspaceLifecyclePicker(request: Request) {
  usePicker.setState({ request });
}

export function useMoveChatMenuAction(
  serverId: string,
  workspaceId: string,
  tabId: string,
  agentId: string | null,
) {
  return useCallback(() => {
    if (workspaceId && agentId)
      openWorkspaceLifecyclePicker({ kind: "move", serverId, workspaceId, agentId, tabId });
  }, [agentId, serverId, tabId, workspaceId]);
}

function accept<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }) {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

interface Choice {
  id: string;
  label: string;
  hint?: string;
  open(): Promise<{ workspaceId: string }>;
}
const headers = {
  move: { title: "Move chat to workspace" },
  reopen: { title: "Reopen worktree" },
};
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: Choice[] };

function Picker({ request }: { request: Request }) {
  const client = useHostRuntimeClient(request.serverId);
  const online = useHostRuntimeIsConnected(request.serverId);
  const [state, setState] = useState<State>({ status: "loading" });
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    if (!client || !online) return;
    let active = true;
    const hostId = request.serverId;
    const call = (name: string, input: unknown) =>
      client.invokePluginRpc("otto-workspace-git", name, input);
    async function load(): Promise<Choice[]> {
      if (request.kind === "move") {
        const choices = accept(
          listWorkspaceMoveTargets.output.parse(
            await call(listWorkspaceMoveTargets.name, { hostId, workspaceId: request.workspaceId }),
          ),
        );
        return choices.map((entry) => ({
          id: entry.workspaceId,
          label: entry.label,
          hint: entry.project,
          open: async () =>
            accept(
              moveWorkspaceChat.output.parse(
                await call(moveWorkspaceChat.name, {
                  hostId,
                  fromWorkspaceId: request.workspaceId,
                  workspaceId: entry.workspaceId,
                  agentId: request.agentId,
                }),
              ),
            ),
        }));
      }
      const choices = accept(
        listReopenWorktrees.output.parse(
          await call(listReopenWorktrees.name, { hostId, projectId: request.projectId }),
        ),
      );
      return choices.map((entry) => ({
        id: entry.target.kind === "archived" ? entry.target.workspaceId : entry.target.path,
        label: entry.label,
        hint: entry.branch ?? undefined,
        open: async () =>
          accept(
            reopenWorktree.output.parse(
              await call(reopenWorktree.name, {
                hostId,
                projectId: request.projectId,
                target: entry.target,
              }),
            ),
          ),
      }));
    }
    setState({ status: "loading" });
    async function refresh() {
      try {
        const items = await load();
        if (active) setState({ status: "ready", items });
      } catch (error) {
        if (active) setState({ status: "error", message: errorMessage(error) });
      }
    }
    void refresh();
    return () => {
      active = false;
    };
  }, [client, online, request]);
  const choose = useCallback(
    async (choice: Choice) => {
      if (pendingRef.current || !online) return;
      pendingRef.current = true;
      setPending(true);
      setFailure("");
      try {
        const { workspaceId } = await choice.open();
        if (usePicker.getState().request !== request) return;
        close();
        if (request.kind === "move") {
          useWorkspaceLayoutStore
            .getState()
            .closeTab(`${request.serverId}:${request.workspaceId}`, request.tabId);
          navigateToWorkspace({
            serverId: request.serverId,
            workspaceId,
            target: { kind: "agent", agentId: request.agentId },
          });
        } else {
          navigateToWorkspace({ serverId: request.serverId, workspaceId });
        }
      } catch (error) {
        if (usePicker.getState().request === request) setFailure(errorMessage(error));
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [online, request],
  );
  const dismiss = useCallback(() => {
    if (!pending) close();
  }, [pending]);
  return (
    <AdaptiveModalSheet
      visible
      header={headers[request.kind]}
      onClose={dismiss}
      testID={`otto-workspace-${request.kind}`}
    >
      <View style={styles.content}>
        {request.kind === "move" ? (
          <Text style={styles.hint}>The chat keeps its working directory and conversation.</Text>
        ) : null}
        {failure ? <Alert variant="error" description={failure} /> : null}
        <Choices online={online} state={state} disabled={pending} choose={choose} />
      </View>
    </AdaptiveModalSheet>
  );
}

function Choices({
  online,
  state,
  disabled,
  choose,
}: {
  online: boolean;
  state: State;
  disabled: boolean;
  choose(item: Choice): Promise<void>;
}) {
  if (!online) return <Alert variant="warning" description="Connect to the workspace host." />;
  if (state.status === "loading") return <Text style={styles.hint}>Loading workspaces…</Text>;
  if (state.status === "error") return <Alert variant="error" description={state.message} />;
  if (!state.items.length) return <Text style={styles.hint}>No matching workspaces.</Text>;
  return (
    <SettingsCard>
      {state.items.map((item) => (
        <ChoiceRow key={item.id} item={item} disabled={disabled} choose={choose} />
      ))}
    </SettingsCard>
  );
}

function ChoiceRow({
  item,
  disabled,
  choose,
}: {
  item: Choice;
  disabled: boolean;
  choose(item: Choice): Promise<void>;
}) {
  const select = useCallback(() => void choose(item), [choose, item]);
  return (
    <SettingsRow label={item.label} hint={item.hint}>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onPress={select}
        accessibilityLabel={`Select ${item.label}`}
        testID={`otto-workspace-choice-${item.id}`}
      >
        Select
      </Button>
    </SettingsRow>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The host did not confirm the operation.";
}

export function WorkspaceLifecyclePicker() {
  const request = usePicker((state) => state.request);
  return request ? <Picker key={JSON.stringify(request)} request={request} /> : null;
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing[3] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
