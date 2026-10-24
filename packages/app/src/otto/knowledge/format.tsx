import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import {
  inspectKnowledgeFormat,
  applyKnowledgeFormat,
  type KnowledgeScope,
  type KnowledgeFormatPlan,
} from "@getpaseo/plugin/otto/project-knowledge";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { KnowledgeFormatModel } from "./format-model";
import { styles } from "./styles";

function planLabel(plan: KnowledgeFormatPlan) {
  if (!plan.required) return "No older formats need conversion.";
  if (!plan.count) return "Finish pending conversion";
  return `${plan.count} records need conversion`;
}

export function KnowledgeFormat({ scope, active }: { scope: KnowledgeScope; active: boolean }) {
  const inspect = useRpc(inspectKnowledgeFormat);
  const apply = useRpc(applyKnowledgeFormat);
  const cache = useQueryClient();
  const [model] = useState(
    () =>
      new KnowledgeFormatModel({
        inspect: () => inspect({ scope }),
        apply: (input) => apply({ scope, ...input }),
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
  const reason = useCallback((value: string) => model.setReason(value), [model]);
  const preview = useCallback(async () => {
    const authority = model.getAuthority();
    if (
      (state.reason || state.blocked) &&
      !(await confirmDialog({
        title: "Reload conversion preview?",
        message:
          "This clears the captured preview and local reason. Saved Knowledge remains unchanged.",
        confirmLabel: "Reload preview",
      }))
    )
      return;
    await model.inspect(authority);
  }, [model, state.reason, state.blocked]);
  const convert = useCallback(async () => {
    const authority = model.getAuthority();
    if (
      !(await confirmDialog({
        title: "Convert older Knowledge formats?",
        message: `Convert ${state.plan?.count ?? 0} records in the selected owning-host store. Otto verifies byte recovery copies first, retains original JSON, and preserves identities, review status, roots and history. An interrupted conversion requires a fresh inspection.`,
        confirmLabel: "Convert formats",
      }))
    )
      return;
    await model.apply(authority);
  }, [model, state.plan]);
  const changes = useMemo(
    () =>
      state.plan?.changes.map((item) => (
        <SettingsRow
          key={JSON.stringify([item.kind, item.id])}
          label={item.title}
          hint={`${item.action}: ${item.source}`}
        />
      )),
    [state.plan],
  );
  return (
    <SettingsSection title="Older Knowledge formats" testID="knowledge-format">
      <SettingsCard>
        <SettingsRow
          label="Inspect before converting"
          hint="Older JSON and section-based Markdown can be converted explicitly. Inspection never rewrites data; original bytes are retained for recovery."
        >
          <Button variant="outline" size="sm" onPress={preview} disabled={!active || state.busy}>
            {state.busy ? "Working..." : "Inspect formats"}
          </Button>
        </SettingsRow>
        {state.error ? <Alert variant="error" description={state.error} /> : null}
        {state.success ? <Alert description={state.success} /> : null}
        {state.plan ? (
          <SettingsRow
            label={planLabel(state.plan)}
            hint={state.plan.required ? `Recovery: ${state.plan.recoveryPath}` : undefined}
          />
        ) : null}
        {changes}
        {state.plan?.omitted ? (
          <SettingsRow
            label={`${state.plan.omitted} additional records are included in this inspected plan.`}
          />
        ) : null}
      </SettingsCard>
      {state.plan?.required && !state.success ? (
        <>
          <Field label="Conversion reason">
            <FormTextInput
              key={state.generation}
              initialValue={state.reason}
              onChangeText={reason}
              accessibilityLabel="Conversion reason"
              editable={!state.busy}
            />
          </Field>
          <View style={styles.actions}>
            <Button
              variant="secondary"
              onPress={convert}
              disabled={!active || state.busy || state.blocked || !state.reason.trim()}
            >
              Convert formats
            </Button>
          </View>
        </>
      ) : null}
    </SettingsSection>
  );
}
