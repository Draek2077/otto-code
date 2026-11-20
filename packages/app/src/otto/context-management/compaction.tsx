import {
  useCallback,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ScrollView, View } from "react-native";
import { Bot } from "lucide-react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  readContextRefinementSet,
  proposeContextRefinement,
  applyContextRefinement,
  type ContextReport,
  type ContextSelection,
} from "@getpaseo/plugin/otto/context-management";
import { SettingsSection } from "@/components/settings";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ReviewModelPicker } from "@/otto/knowledge/review-model-picker";
import type { ContextEdgeEdit, ContextEdgeEditState } from "./edge-edit";
import {
  ContextCompactionModel,
  keptContextText,
  type ContextCompactionState,
} from "./compaction-model";
import { ContextCompactionFiles } from "./compaction-files";
import { ContextCompactionReview } from "./compaction-review";
import { contextCompactionPresets } from "./compaction-presets";
import { useContextEditOrigin } from "./use-edit-origin";
import { styles } from "./styles";

interface CompactionProps {
  scope: ContextSelection & { workspaceFiles?: true };
  selectedId: string;
  nodes: ContextReport["nodes"];
  active: boolean;
  writeModel: ContextEdgeEdit;
  writeState: ContextEdgeEditState;
  onClose(): void;
  onChanged(): void;
  onReviewed(): Promise<void>;
  beforeWrite?(): Promise<void>; // OTTO(refine)
  additionalRewriteIds?: readonly string[];
  onReviewState?(draft: boolean, busy: boolean): void;
}
function Instruction({ model }: { model: ContextCompactionModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const compact = useIsCompactFormFactor();
  const edit = useCallback((text: string) => model.setInstruction(text), [model]);
  return (
    <Field label="Compaction instruction">
      <FormTextInput
        key={state.instructionVersion}
        initialValue={state.instruction}
        onChangeText={edit}
        editable={!state.busy}
        size={compact ? "md" : "sm"}
        multiline
        testID="context-compaction-instruction"
      />
    </Field>
  );
}
function Preset({
  model,
  preset,
}: {
  model: ContextCompactionModel;
  preset: (typeof contextCompactionPresets)[number];
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const choose = useCallback(() => model.preset(preset.instruction), [model, preset]);
  return (
    <Button variant="outline" size="sm" onPress={choose} disabled={state.busy}>
      {preset.label}
    </Button>
  );
}
function proposalActions(
  state: ContextCompactionState,
  options: { disabled: boolean; writeBlocked: boolean; refine: boolean },
) {
  const hasProposal = state.documents.some((item) => item.diff !== null);
  const unavailable = options.disabled || state.blocked || state.setChanged;
  return {
    generate:
      !unavailable &&
      state.loaded &&
      !!state.instruction.trim() &&
      (options.refine || !state.documents.some((item) => item.diff?.hunks.length)),
    reset: !unavailable && hasProposal,
    save:
      !unavailable &&
      !options.writeBlocked &&
      state.documents.some((item) => keptContextText(item) !== item.file.text),
    generationLabel: options.refine && hasProposal ? "Regenerate" : "Generate proposal",
  };
}

export function ContextCompaction(props: CompactionProps) {
  const read = useRpc(readContextRefinementSet),
    propose = useRpc(proposeContextRefinement),
    apply = useRpc(applyContextRefinement);
  const [model] = useState(
    () =>
      new ContextCompactionModel(
        props.nodes,
        props.selectedId,
        {
          async read(nodeIds, referenceNodeIds) {
            const result = await read({ ...props.scope, nodeIds, referenceNodeIds });
            if (!result.ok) throw new Error(result.error.message);
            return result.value;
          },
          async propose(input) {
            const result = await propose({ ...props.scope, ...input });
            if (!result.ok) throw new Error(result.error.message);
            return result.value;
          },
          async apply(input) {
            try {
              await props.beforeWrite?.();
            } catch (error) {
              return {
                ok: false,
                message:
                  error instanceof Error ? error.message : "Save the open editor drafts first.",
              };
            }
            const result = await apply({ ...props.scope, ...input, userApprovedSave: true });
            if (!result.ok) return { ok: false, message: result.error.message };
            return { ok: true, files: result.value.files };
          },
        },
        props.scope.workspaceFiles === true,
        props.additionalRewriteIds,
      ),
  );
  useLayoutEffect(() => (props.active ? model.activate() : undefined), [props.active, model]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const captureOrigin = useContextEditOrigin(props.active);
  const { onReviewed, onClose, onChanged, writeModel } = props;
  const load = useCallback(async () => {
    const loaded = await model.load(() =>
      confirmDialog({
        title: "Discard this local compaction review?",
        message:
          "Load current files and revisions from the host? Local proposals and hunk decisions are discarded; saved files stay unchanged.",
        confirmLabel: "Load selected files",
      }),
    );
    if (loaded) await onReviewed();
  }, [model, onReviewed]);
  const generate = useCallback(() => model.generate(), [model]);
  const kept = useCallback(() => model.reviewKeptResult(), [model]);
  const startOver = useCallback(
    () =>
      model.startOver(() =>
        confirmDialog({
          title: "Start over from the original documents?",
          message: "This clears the proposal and hunk choices. Saved files stay as they are.",
          confirmLabel: "Start over",
        }),
      ),
    [model],
  );
  const save = useCallback(
    () =>
      model.apply(
        writeModel,
        (globalFiles) =>
          confirmDialog({
            title: globalFiles.length
              ? "Apply host-wide and project changes?"
              : "Apply kept context changes?",
            message: globalFiles.length
              ? `These host-wide sources affect other projects: ${globalFiles.join(", ")}. Only kept changes are saved. Individual file failures are reported without rollback or retry.`
              : "Only the kept changes are saved to their owning files. Captured prompts and chat history stay unchanged. Individual file failures are reported without rollback or retry.",
            confirmLabel: "Apply kept changes",
          }),
        onChanged,
      ),
    [model, writeModel, onChanged],
  );
  const close = useCallback(async () => {
    const current = captureOrigin();
    if (
      model.hasDraft() &&
      !(await confirmDialog({
        title: "Discard local compaction review?",
        message:
          "The local proposal and hunk decisions will be discarded. Files already saved stay saved.",
        confirmLabel: "Back to context",
      }))
    )
      return;
    if (current()) onClose();
  }, [captureOrigin, model, onClose]);
  const hasDraft = state.documents.some((item) => item.diff || item.working !== item.file.text);
  const { onReviewState } = props;
  useLayoutEffect(
    () => onReviewState?.(hasDraft && !state.blocked, state.busy),
    [hasDraft, onReviewState, state.blocked, state.busy],
  );
  const disabled = !props.active || state.busy || props.writeState.busy;
  const actions = proposalActions(state, {
    disabled,
    writeBlocked: props.writeState.blocked,
    refine: model.refine,
  });
  return (
    <ScrollView
      nestedScrollEnabled
      style={styles.page}
      contentContainerStyle={styles.content}
      testID="context-compaction"
    >
      <SettingsSection
        title={props.scope.workspaceFiles ? "Refine with AI" : "Compact with AI"}
        info="Review a bounded prose working set. Generating and keeping a hunk do not write files; applying requires explicit confirmation."
      >
        <View style={styles.actions}>
          <Button variant="outline" size="sm" onPress={close} disabled={disabled}>
            {props.scope.workspaceFiles ? "Close Refine" : "Back to context"}
          </Button>
        </View>
        {state.error ? <Alert variant="error" description={state.error} /> : null}
        {state.blocked ? (
          <Alert
            variant="warning"
            description="Reload and review the selected files before another apply. No automatic retry or revision adoption is used."
          />
        ) : null}
        {state.outcomes.map((outcome) => (
          <Alert
            key={outcome.nodeId}
            testID={`context-compaction-result-${outcome.nodeId}`}
            variant={
              outcome.status === "changed" || outcome.status === "unchanged" ? "info" : "error"
            }
            description={`${outcome.label}: ${outcome.message}`}
          />
        ))}
      </SettingsSection>
      <ContextCompactionFiles model={model} />
      <View style={styles.actions}>
        <Button variant="outline" size="sm" onPress={load} disabled={disabled}>
          Load selected files
        </Button>
      </View>
      <SettingsSection title="Proposal">
        <View style={styles.actions}>
          {contextCompactionPresets.map((preset) => (
            <Preset key={preset.id} model={model} preset={preset} />
          ))}
        </View>
        <Instruction model={model} />
        <ReviewModelPicker model={model} hostId={props.scope.hostId} active={props.active} />
        <View style={styles.actions}>
          <Button leftIcon={Bot} size="sm" onPress={generate} disabled={!actions.generate}>
            {actions.generationLabel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onPress={model.refine ? startOver : kept}
            disabled={!actions.reset}
          >
            {model.refine ? "Start over" : "Review kept result"}
          </Button>
          <Button variant="default" size="sm" onPress={save} disabled={!actions.save}>
            Apply kept changes
          </Button>
        </View>
        {state.inputCharacters !== null ? (
          <Alert
            variant="info"
            description={`The last proposal used ${state.inputCharacters.toLocaleString()} document/reference characters plus the instruction and service framing. This is not a billed token count.`}
          />
        ) : null}
      </SettingsSection>
      <ContextCompactionReview model={model} />
    </ScrollView>
  );
}
export function ContextCompactionGate(
  props: Omit<CompactionProps, "selectedId" | "nodes"> & {
    selectedId: string | null;
    report: ContextReport | undefined;
    children: ReactNode;
  },
) {
  if (!props.selectedId || !props.report) return props.children;
  return (
    <ContextCompaction
      key={props.selectedId}
      scope={props.scope}
      selectedId={props.selectedId}
      nodes={props.report.nodes}
      active={props.active}
      writeModel={props.writeModel}
      writeState={props.writeState}
      onClose={props.onClose}
      onChanged={props.onChanged}
      onReviewed={props.onReviewed}
    />
  );
}
