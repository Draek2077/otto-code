import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { View, Text } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { workflowPreviewTemplate, unwrapWorkflowResult } from "@getpaseo/plugin/otto/workflows";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { WorkflowDraft } from "./draft";
import { WorkflowTemplatePreviewForm } from "./template-preview-model";
import { TextField, Toggle } from "./fields";
import { styles } from "./styles";
export function TemplatePreview({ draft, active }: { draft: WorkflowDraft; active: boolean }) {
  const [model] = useState(() => new WorkflowTemplatePreviewForm(draft)),
    state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    source = useSyncExternalStore(draft.subscribe, draft.getSnapshot),
    call = useRpc(workflowPreviewTemplate);
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const variables = useCallback((value: string) => model.variables(value), [model]),
    allow = useCallback((value: boolean) => model.allow(value), [model]);
  const preview = useCallback(
    () => model.preview(async (input) => unwrapWorkflowResult(await call(input))),
    [model, call],
  );
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Template preview</Text>
      <TextField
        label="Preview variables (JSON object)"
        value={state.variables}
        onChange={variables}
        multiline
        disabled={state.busy}
      />
      <Toggle
        label="Allow EJS code on the owning host for this preview"
        value={state.allowCode}
        onChange={allow}
        disabled={state.busy}
      />
      {state.allowCode ? (
        <Alert
          variant="warning"
          description="This preview executes template code with daemon filesystem authority. It is bounded, not filesystem-isolated."
        />
      ) : null}
      <Button
        variant="outline"
        onPress={preview}
        disabled={!active || state.busy}
        loading={state.busy}
      >
        Render preview
      </Button>
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.version === source.version ? (
        <Text selectable style={styles.code}>
          {state.text}
        </Text>
      ) : null}
    </View>
  );
}
