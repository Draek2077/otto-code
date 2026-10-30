import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import {
  createArtifact,
  type ArtifactScope,
  type ArtifactSummary,
} from "@getpaseo/plugin/otto/artifacts";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ArtifactTextField } from "./detail";
import { artifactCreateDraftFor, discardArtifactCreateDraft } from "./model";
import { ReviewModelPicker } from "../knowledge/review-model-picker";
import { confirmDialog } from "@/utils/confirm-dialog";
import { styles } from "./styles";
export function ArtifactCreate({
  scope,
  active,
  created,
  close,
}: {
  scope: ArtifactScope;
  active: boolean;
  created(item: ArtifactSummary): void;
  close(): void;
}) {
  const owner = usePaseo(),
    create = useRpc(createArtifact);
  const [model] = useState(() => artifactCreateDraftFor(owner, scope));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const changeName = useCallback((value: string) => model.edit("name", value), [model]);
  const changeDescription = useCallback(
    (value: string) => model.edit("description", value),
    [model],
  );
  const submit = useCallback(async () => {
    const accepted = await model.submit(async (input) => {
      const result = await create(input);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    });
    if (accepted) {
      discardArtifactCreateDraft(owner, scope);
      created(accepted);
    }
  }, [model, create, owner, scope, created]);
  const discard = useCallback(async () => {
    if (
      await confirmDialog({
        title: "Discard creation draft?",
        message:
          "Check the library first if creation may have completed. Discard this local draft?",
        confirmLabel: "Discard draft",
        cancelLabel: "Keep draft",
      })
    ) {
      discardArtifactCreateDraft(owner, scope);
      close();
    }
  }, [owner, scope, close]);
  return (
    <View style={styles.card} testID="artifact-create-form">
      <Text style={styles.title}>New artifact</Text>
      <ArtifactTextField
        label="Artifact name"
        value={state.name}
        onChange={changeName}
        disabled={state.busy}
      />
      <ArtifactTextField
        label="Describe the artifact"
        value={state.description}
        onChange={changeDescription}
        multiline
        disabled={state.busy}
      />
      <ReviewModelPicker model={model} hostId={scope.hostId} active={active} />
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.created ? (
        <Text
          style={styles.muted}
        >{`Created artifact: ${state.created.id}. Find it in the library.`}</Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          disabled={state.busy || state.blocked || !active}
          loading={state.busy}
          onPress={submit}
        >
          Create artifact
        </Button>
        <Button variant="outline" disabled={state.busy} onPress={close}>
          Keep draft and close
        </Button>
        <Button variant="ghost" disabled={state.busy} onPress={discard}>
          Discard draft
        </Button>
      </View>
    </View>
  );
}
