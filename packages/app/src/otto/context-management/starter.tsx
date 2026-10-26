import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  readContextStarter,
  proposeContextStarter,
  createContextStarter,
  type ContextSelection,
  type ContextReport,
} from "@getpaseo/plugin/otto/context-management";
import { SettingsSection, SettingsSelect } from "@/components/settings";
import { FormTextInput } from "@/components/ui/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react-native";
import { ReviewModelPicker } from "@/otto/knowledge/review-model-picker";
import { confirmDialog } from "@/utils/confirm-dialog";
import { ContextStarterModel, needsContextStarter } from "./starter-model";
import { RetainedPanel } from "@/components/retained-panel";
import { useHostFeature } from "@/runtime/host-features";
import type { ContextEdgeEdit, ContextEdgeEditState } from "./edge-edit";
import { styles } from "./styles";

const names = [
  { value: "AGENTS.md", label: "AGENTS.md" },
  { value: "CLAUDE.md", label: "CLAUDE.md" },
];
function discard() {
  return confirmDialog({
    title: "Discard this starter draft?",
    message:
      "Reload repository context and discard this local draft? Existing files stay unchanged.",
    confirmLabel: "Reload repository context",
  });
}
export function ContextStarterSetup({
  scope,
  active,
  writeModel,
  writeState,
  onChanged,
}: {
  scope: ContextSelection;
  active: boolean;
  writeModel: ContextEdgeEdit;
  writeState: ContextEdgeEditState;
  onChanged(): void;
}) {
  const read = useRpc(readContextStarter),
    propose = useRpc(proposeContextStarter),
    create = useRpc(createContextStarter);
  const { hostId, workspaceId } = scope;
  // Project setup belongs to the workspace, independent of the inspected chat
  // or what-if budget. Those controls cannot discard an in-progress starter.
  const starterScope = useMemo<ContextSelection>(
    () => ({ hostId, workspaceId, agentId: null, windowTokens: 200000 }),
    [hostId, workspaceId],
  );
  const model = useMemo(
    () =>
      new ContextStarterModel({
        async read(fileName) {
          const reply = await read({ ...starterScope, fileName });
          if (!reply.ok) throw new Error(reply.error.message);
          return reply.value;
        },
        async propose(input) {
          const reply = await propose({ ...starterScope, ...input });
          if (!reply.ok) throw new Error(reply.error.message);
          return reply.value;
        },
        async create(input) {
          const reply = await create({ ...starterScope, ...input, userApprovedCreate: true });
          return reply.ok ? { ok: true } : { ok: false, message: reply.error.message };
        },
      }),
    [starterScope, read, propose, create],
  );
  useLayoutEffect(() => (active ? model.activate() : undefined), [model, active]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const load = useCallback(() => model.load(model.getSnapshot().fileName, discard), [model]);
  const choose = useCallback(
    (name: string) => {
      if (name === "AGENTS.md" || name === "CLAUDE.md") void model.load(name, discard);
    },
    [model],
  );
  const generate = useCallback(
    () =>
      model.generate(() =>
        confirmDialog({
          title: "Replace this starter draft?",
          message:
            "Generate a new proposal in place of your local draft? No project files will be changed.",
          confirmLabel: "Generate new draft",
        }),
      ),
    [model],
  );
  const edit = useCallback((text: string) => model.edit(text), [model]);
  const guidance = useCallback((text: string) => model.setInstruction(text), [model]);
  const save = useCallback(
    () =>
      model.save(
        writeModel,
        () =>
          confirmDialog({
            title: `Create ${model.getSnapshot().fileName}?`,
            message:
              "Create the reviewed instruction file in this project's root? Future provider requests may load it. Existing files are never overwritten; active conversations may retain their earlier instructions.",
            confirmLabel: "Create instruction file",
          }),
        onChanged,
      ),
    [model, writeModel, onChanged],
  );
  const disabled = !active || state.busy || writeState.busy || writeState.blocked;
  return (
    <SettingsSection
      title="Set up your project context"
      info="Generate a starter draft from root filenames and a bounded README excerpt. Review and edit it before explicitly creating a project instruction file."
    >
      <View style={styles.preview} testID="context-starter">
        <SettingsSelect
          label="Instruction file"
          value={state.fileName}
          options={names}
          onValueChange={choose}
          disabled={disabled}
        />
        {state.error ? <Alert variant="error" description={state.error} /> : null}
        <View style={styles.actions}>
          <Button variant="outline" size="sm" onPress={load} disabled={disabled}>
            Load repository context
          </Button>
        </View>
        {state.origin ? (
          <>
            <Text
              selectable
              style={styles.caption}
            >{`Project: ${state.origin.projectLabel}. Only the reviewed ${state.origin.fileName} will be created.`}</Text>
            <FormTextInput
              initialValue={state.instruction}
              onChangeText={guidance}
              accessibilityLabel="Starter instructions"
              placeholder="Optional guidance for this project's instructions"
              editable={!disabled}
              multiline
            />
            <ReviewModelPicker model={model} hostId={scope.hostId} active={active} />
            <View style={styles.actions}>
              <Button
                leftIcon={Bot}
                size="sm"
                onPress={generate}
                disabled={disabled || state.created}
              >
                Generate starter draft
              </Button>
            </View>
            <FormTextInput
              key={state.version}
              initialValue={state.text}
              onChangeText={edit}
              accessibilityLabel="Starter draft"
              testID="context-starter-draft"
              editable={!disabled && !state.created}
              multiline
              autoCorrect={false}
              autoCapitalize="none"
            />
            <View style={styles.actions}>
              <Button
                size="sm"
                onPress={save}
                disabled={disabled || !state.text.trim() || state.created}
              >
                Create reviewed instruction file
              </Button>
            </View>
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}

export function ContextStarterGate(
  props: Parameters<typeof ContextStarterSetup>[0] & {
    ready: boolean;
    report: ContextReport | undefined;
    children: ReactNode;
    selected: boolean;
  },
) {
  // COMPAT(ottoContextStarter): added v0.10.0; remove after 2027-04-26 when host floor >= v0.10.0.
  const supported = useHostFeature(props.scope.hostId, "ottoContextStarter");
  if (!props.ready || !props.report) return null;
  if (!needsContextStarter(props.report)) return props.children;
  if (!supported)
    return props.selected ? (
      props.children
    ) : (
      <Alert variant="info" description="Update the host to set up project context." />
    );
  return (
    <>
      <RetainedPanel active={!props.selected}>
        <ContextStarterSetup {...props} active={props.active && !props.selected} />
      </RetainedPanel>
      {props.selected ? props.children : null}
    </>
  );
}
