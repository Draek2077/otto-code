import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { SettingsSelect } from "@/components/settings";
import { SettingsExpander } from "@/otto/plugin-settings-ui";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import {
  startViewAuthoring,
  type ViewScope,
  type ViewIdentity,
  type ViewDraft,
} from "@getpaseo/plugin/otto/architectural-views";
import { ReviewModelPicker } from "../knowledge/review-model-picker";
import { WorkflowSeatOptions } from "../workflows/seat-options";
import { ViewAuthoringModel } from "./authoring-model";
import { useViewClient, unwrapView } from "./data";
import { openViewChat } from "./navigation";
import { styles } from "./styles";
export function ViewAuthoringForm({
  scope,
  identity,
  draft,
  active,
  disabled,
  workspaceId,
  workspaces,
  accepted,
}: {
  scope: ViewScope;
  identity: ViewIdentity;
  draft: ViewDraft;
  active: boolean;
  disabled: boolean;
  workspaceId: string;
  workspaces: { value: string; label: string }[];
  accepted(draft: ViewDraft, expectedRevision: string): void;
}) {
  const [model] = useState(() => new ViewAuthoringModel(workspaceId)),
    state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    client = useViewClient(scope.hostId);
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const workspace = useCallback((value: string) => model.workspace(value), [model]);
  const mode = useCallback((value: string) => model.mode(value), [model]);
  const thinking = useCallback((value: string) => model.thinking(value), [model]);
  const seat = useMemo(
    () => ({
      provider: state.selection?.provider ?? "",
      model: state.selection?.model,
      modeId: state.modeId,
      thinkingOptionId: state.thinkingOptionId,
    }),
    [state.selection, state.modeId, state.thinkingOptionId],
  );
  const start = useCallback(async () => {
    const expectedRevision = draft.revision;
    const result = await model.start(async (input) =>
      unwrapView(
        await client.call(startViewAuthoring, {
          ...input,
          scope,
          identity,
          draftId: draft.draftId,
          expectedRevision,
          userApproved: true,
        }),
      ),
    );
    if (!result) return;
    accepted(result.draft, expectedRevision);
    openViewChat(scope.hostId, result.workspaceId, result.agentId);
  }, [model, client, scope, identity, draft.draftId, draft.revision, accepted]);
  const open = useCallback(() => {
    if (draft.authoringAgentId && draft.authoringWorkspaceId)
      openViewChat(scope.hostId, draft.authoringWorkspaceId, draft.authoringAgentId);
  }, [draft.authoringAgentId, draft.authoringWorkspaceId, scope.hostId]);
  if (draft.authoringAgentId && draft.authoringWorkspaceId)
    return (
      <Button size="sm" variant="outline" onPress={open}>
        Open authoring chat
      </Button>
    );
  return (
    <SettingsExpander label="Author with a chat">
      <View style={styles.content}>
        <SettingsSelect
          label="Authoring workspace"
          value={state.workspaceId}
          options={workspaces}
          onValueChange={workspace}
          disabled={state.busy || disabled}
        />
        <ReviewModelPicker
          model={model}
          hostId={scope.hostId}
          active={active}
          allowAutomatic={false}
        />
        <WorkflowSeatOptions
          seat={seat}
          hostId={scope.hostId}
          active={active}
          disabled={state.busy || disabled}
          onMode={mode}
          onThinking={thinking}
        />
        {state.error ? <Alert variant="error" description={state.error} /> : null}
        <Button
          onPress={start}
          disabled={
            !active ||
            disabled ||
            state.busy ||
            state.blocked ||
            !state.selection ||
            !state.workspaceId
          }
        >
          Start authoring chat
        </Button>
      </View>
    </SettingsExpander>
  );
}
