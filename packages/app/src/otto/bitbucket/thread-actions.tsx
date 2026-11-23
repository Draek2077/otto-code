import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { View } from "react-native";
import {
  readBitbucketConnections,
  setBitbucketThreadResolution,
} from "@getpaseo/plugin/otto/bitbucket-connections";
import { useInstalledPlugin } from "@/plugins/registry";
import { useHostFeature } from "@/runtime/host-features";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { PrThreadEntry } from "@/git/pull-request-panel/timeline";
import type { InstalledPlugin } from "@/plugins/types";
import { openBitbucketThreadAction, BitbucketThreadActionError } from "./thread-action";
interface Target {
  serverId: string;
  cwd: string;
  number: number;
  forge: string;
}
const Context = createContext<Target | null>(null);
function Provider({ target, children }: { target: Target; children: ReactNode }) {
  const available = useHostFeature(target.serverId, "ottoBitbucket");
  const value = useMemo(
    () => (available && target.forge === "bitbucket-cloud" ? target : null),
    [available, target],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function withOttoBitbucketPrContext(target: Target, children: ReactNode) {
  return <Provider target={target}>{children}</Provider>;
}
export function OttoBitbucketThreadAction({ thread }: { thread: PrThreadEntry }) {
  const target = useContext(Context);
  if (!target) return null;
  return (
    <InstalledThreadAction
      key={`${target.serverId}:${target.cwd}:${target.number}:${thread.id}`}
      target={target}
      thread={thread}
    />
  );
}
function InstalledThreadAction({ target, thread }: { target: Target; thread: PrThreadEntry }) {
  const plugin = useInstalledPlugin(target.serverId, "otto-integrations");
  const commentId = Number(thread.comments[0].threadId ?? thread.comments[0].id);
  if (!plugin || !Number.isSafeInteger(commentId) || commentId < 1) return null;
  return (
    <Action
      target={target}
      plugin={plugin}
      commentId={commentId}
      resolved={thread.isResolved === true}
    />
  );
}
function Action({
  target,
  plugin,
  commentId,
  resolved,
}: {
  target: Target;
  plugin: InstalledPlugin;
  commentId: number;
  resolved: boolean;
}) {
  const visible = useAppVisible(),
    retained = useRetainedPanelActive();
  const [model] = useState(() =>
    openBitbucketThreadAction({
      revision: async () => {
        const result = readBitbucketConnections.output.parse(
          await plugin.invoke(readBitbucketConnections.name, { hostId: target.serverId }),
        );
        if (!result.ok) throw new BitbucketThreadActionError(result.error.message);
        return result.value.revision;
      },
      confirm: (next) =>
        confirmDialog({
          title: next ? "Resolve Bitbucket discussion?" : "Reopen Bitbucket discussion?",
          message:
            "Update this discussion using the account selected for this project on its host?",
          confirmLabel: next ? "Resolve" : "Reopen",
        }),
      write: async (expectedRevision, next) => {
        const result = setBitbucketThreadResolution.output.parse(
          await plugin.invoke(setBitbucketThreadResolution.name, {
            hostId: target.serverId,
            cwd: target.cwd,
            number: target.number,
            commentId,
            resolved: next,
            expectedRevision,
          }),
        );
        if (!result.ok) throw new BitbucketThreadActionError(result.error.message);
      },
      refresh: () =>
        useCheckoutGitActionsStore
          .getState()
          .refresh({ serverId: target.serverId, cwd: target.cwd }),
    }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    model.setActive(visible && retained);
  }, [model, visible, retained]);
  useEffect(() => () => model.close(), [model]);
  const perform = useCallback(() => model.perform(!resolved), [model, resolved]);
  const label = resolved ? "Reopen discussion" : "Resolve discussion";
  return (
    <View>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.blocked ? (
        <Button size="xs" variant="outline" onPress={model.reload} disabled={state.busy}>
          Refresh discussion
        </Button>
      ) : (
        <Button size="xs" variant="ghost" onPress={perform} disabled={state.busy}>
          {state.busy ? "Updating…" : label}
        </Button>
      )}
    </View>
  );
}
