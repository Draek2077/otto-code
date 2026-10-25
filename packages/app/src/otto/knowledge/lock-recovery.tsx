import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  inspectKnowledgeWriteLock,
  recoverKnowledgeWriteLock,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import { useQueryClient } from "@tanstack/react-query";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@/components/settings";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useIsCompactFormFactor } from "@/constants/layout";
import { confirmDialog } from "@/utils/confirm-dialog";
import { KnowledgeLockRecoveryModel } from "./lock-recovery-model";
import { styles } from "./styles";

export function KnowledgeLockRecovery({
  scope,
  active,
}: {
  scope: KnowledgeScope;
  active: boolean;
}) {
  const inspect = useRpc(inspectKnowledgeWriteLock);
  const recover = useRpc(recoverKnowledgeWriteLock);
  const cache = useQueryClient();
  const [model] = useState(
    () =>
      new KnowledgeLockRecoveryModel({
        inspect: () => inspect({ scope }),
        recover: (input) => recover({ scope, ...input }),
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
  const inspectLock = useCallback(() => {
    void model.inspect();
  }, [model]);
  return (
    <SettingsSection title="Write lock recovery" testID="knowledge-lock-recovery">
      <SettingsCard>
        <SettingsRow label="Inspect the owning store's write lock">
          <Button
            variant="outline"
            size="sm"
            onPress={inspectLock}
            disabled={!active || state.busy}
          >
            Inspect write lock
          </Button>
        </SettingsRow>
        {state.plan ? <SettingsRow label={state.plan.message} /> : null}
      </SettingsCard>
      <RecoveryIntent model={model} active={active} />
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.success ? <Alert variant="info" description={state.success} /> : null}
    </SettingsSection>
  );
}

function RecoveryIntent({ model, active }: { model: KnowledgeLockRecoveryModel; active: boolean }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const compact = useIsCompactFormFactor();
  const reason = useCallback((value: string) => model.setReason(value), [model]);
  const verify = useCallback((value: boolean) => model.verify(value), [model]);
  const submit = useCallback(
    () =>
      model.recover(() =>
        confirmDialog({
          title: "Recover this write lock?",
          message:
            "Continue only after verifying that every Knowledge writer using this store has stopped, including other daemon processes. The empty lock is retained as evidence. Articles, roots, settings and pending writes are not applied or retried. An active writer on another daemon cannot be detected here.",
          confirmLabel: "Recover verified lock",
        }),
      ),
    [model],
  );
  if (state.plan?.state !== "unverified") return null;
  return (
    <>
      <SettingsCard>
        <SettingsSwitch
          label="I verified that all Knowledge writers using this store have stopped"
          value={state.verified}
          onValueChange={verify}
          disabled={!active || state.busy || state.blocked}
        />
      </SettingsCard>
      <Field label="Recovery reason">
        <FormTextInput
          key={state.generation}
          initialValue={state.reason}
          onChangeText={reason}
          accessibilityLabel="Recovery reason"
          editable={active && !state.busy && !state.blocked}
          size={compact ? "md" : "sm"}
        />
      </Field>
      <View style={styles.actions}>
        <Button
          variant="outline"
          onPress={submit}
          disabled={
            !active || state.busy || state.blocked || !state.verified || !state.reason.trim()
          }
        >
          {state.busy ? "Recovering..." : "Recover verified lock"}
        </Button>
      </View>
    </>
  );
}
