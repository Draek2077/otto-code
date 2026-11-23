import { useMemo, useCallback, useSyncExternalStore } from "react";
import { View, Text } from "react-native";
import type { WorkflowSeats } from "@getpaseo/plugin/otto/workflows";
import { ReviewModelPicker, type ReviewModelSelection } from "../knowledge/review-model-picker";
import type { WorkflowDraft } from "./draft";
import { WorkflowSeatOptions } from "./seat-options";
import { styles } from "./styles";
function picker(model: WorkflowDraft, role: keyof WorkflowSeats) {
  let snapshot: { selection: ReviewModelSelection | null; busy: boolean } = {
    selection: null,
    busy: false,
  };
  let captured: ReviewModelSelection | null = null;
  return {
    subscribe: model.subscribe,
    getSnapshot() {
      const state = model.getSnapshot(),
        doc = state.document,
        seat = doc.kind === "ai" ? doc.value.seats[role] : null;
      let selection = captured;
      if (!seat?.model) selection = null;
      else if (!selection || selection.provider !== seat.provider || selection.model !== seat.model)
        selection = {
          provider: seat.provider,
          model: seat.model,
          providerLabel: seat.provider,
          modelLabel: seat.model,
        };
      if (
        snapshot.selection?.provider !== selection?.provider ||
        snapshot.selection?.model !== selection?.model ||
        snapshot.selection?.modelLabel !== selection?.modelLabel ||
        snapshot.busy !== state.busy
      )
        snapshot = { selection, busy: state.busy };
      return snapshot;
    },
    selectModel(selection: ReviewModelSelection | null) {
      captured = selection;
      model.patch(
        ["value", "seats", role],
        selection ? { provider: selection.provider, model: selection.model } : { provider: "" },
      );
    },
  };
}
export function DraftSeat({
  model,
  role,
  active,
}: {
  model: WorkflowDraft;
  role: keyof WorkflowSeats;
  active: boolean;
}) {
  const adapter = useMemo(() => picker(model, role), [model, role]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const mode = useCallback(
    (value: string) => model.patch(["value", "seats", role, "modeId"], value || undefined),
    [model, role],
  );
  const thinking = useCallback(
    (value: string) =>
      model.patch(["value", "seats", role, "thinkingOptionId"], value || undefined),
    [model, role],
  );
  if (state.document.kind !== "ai") return null;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{role}</Text>
      <ReviewModelPicker model={adapter} hostId={model.scope.hostId} active={active} />
      <WorkflowSeatOptions
        seat={state.document.value.seats[role]}
        hostId={model.scope.hostId}
        active={active}
        disabled={state.busy}
        onMode={mode}
        onThinking={thinking}
      />
    </View>
  );
}
