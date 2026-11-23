import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import {
  inspectKnowledgeStorage,
  bindKnowledgeStorage,
  type KnowledgeScope,
  type KnowledgeStorageChoice,
} from "@getpaseo/plugin/otto/project-knowledge";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { KnowledgeSetupModel } from "./setup-model";
import { styles } from "./styles";

export function KnowledgeStorageSetup({
  scope,
  active,
}: {
  scope: KnowledgeScope;
  active: boolean;
}) {
  const inspect = useRpc(inspectKnowledgeStorage);
  const bind = useRpc(bindKnowledgeStorage);
  const cache = useQueryClient();
  const [model] = useState(
    () =>
      new KnowledgeSetupModel({
        inspect: () => inspect({ scope }),
        bind: (input) => bind({ scope, ...input }),
        changed: () => {
          void cache.invalidateQueries({ queryKey: ["ottoKnowledge", scope.hostId] });
        },
      }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    model.activate();
    return () => model.close();
  }, [model]);
  useEffect(() => model.setActive(active), [model, active]);
  const inspectStores = useCallback(async () => {
    const authority = model.getAuthority();
    if (
      (state.choice || state.blocked) &&
      !(await confirmDialog({
        title: "Inspect host stores again?",
        message:
          "Discard the captured setup choice and inspect the current saved binding? Existing files remain unchanged.",
        confirmLabel: "Inspect again",
      }))
    )
      return;
    await model.inspect(authority);
  }, [model, state.choice, state.blocked]);
  const choose = useCallback((value: string) => model.choose(value), [model]);
  const submit = useCallback(async () => {
    const authority = model.getAuthority();
    const message = setupMessage(state.choice);
    if (
      !(await confirmDialog({
        title: "Set up Knowledge storage?",
        message,
        confirmLabel: "Apply storage choice",
      }))
    )
      return;
    await model.bind(authority);
  }, [model, state.choice]);
  const options = useMemo(
    () => [
      { value: "", label: "Choose a setup action" },
      { value: "__repository__", label: "Use repository storage instead" },
      { value: "__new__", label: "Create a new empty host store" },
      ...(state.plan?.candidates ?? []).map((candidate) => ({
        value: candidate.directoryName,
        label: `Reconnect ${candidate.directoryName} (${candidate.rootPath})`,
      })),
    ],
    [state.plan],
  );
  const selected = choiceValue(state.choice);
  return (
    <SettingsSection title="Knowledge storage setup" testID="knowledge-storage-setup">
      <SettingsCard>
        <SettingsRow
          label="Inspect saved host stores"
          hint="Choose storage explicitly before initializing this project. Inspection does not initialize or rewrite Knowledge."
        >
          <Button
            variant="outline"
            size="sm"
            onPress={inspectStores}
            disabled={!active || state.busy}
          >
            Inspect host stores
          </Button>
        </SettingsRow>
        {state.plan?.required ? (
          <SettingsSelect
            label="Storage choice"
            value={selected}
            options={options}
            onValueChange={choose}
            disabled={!active || state.busy}
          />
        ) : null}
        {state.plan && !state.plan.required ? (
          <SettingsRow label="Storage is already configured. Reload Knowledge to inspect its current data." />
        ) : null}
        {state.plan?.otherStores ? (
          <SettingsRow
            label={`${state.plan.otherStores} other retained directories remain unchanged and are not selected automatically.`}
          />
        ) : null}
      </SettingsCard>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.plan?.required ? (
        <View style={styles.actions}>
          <Button
            onPress={submit}
            disabled={!active || state.busy || state.blocked || !state.choice}
          >
            {state.busy ? "Applying..." : "Apply storage choice"}
          </Button>
        </View>
      ) : null}
    </SettingsSection>
  );
}
function setupMessage(choice: KnowledgeStorageChoice | null) {
  if (choice?.kind === "repository")
    return "Use repository storage for this project instead of the Host default? Existing host directories remain unchanged. Roots are initialized separately.";
  if (choice?.kind === "new")
    return "Create a new empty host store and persist its identity for this project? Existing retained directories and their contents remain unchanged. Roots are initialized separately.";
  return "Reconnect the explicitly selected retained host store to this project? Its existing records, roots, policy and history will remain unchanged.";
}
function choiceValue(choice: KnowledgeStorageChoice | null) {
  if (choice?.kind === "repository") return "__repository__";
  if (choice?.kind === "new") return "__new__";
  return choice?.directoryName ?? "";
}
