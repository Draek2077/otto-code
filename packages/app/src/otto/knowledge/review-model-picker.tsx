import { useCallback, useMemo, useSyncExternalStore } from "react";
import { View } from "react-native";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { Alert } from "@/components/ui/alert";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { styles } from "./styles";

// OTTO(review-model-picker): the catalog UI is shared by reviewed prose operations; drafts stay with each feature.
export interface ReviewModelSelection {
  provider: string;
  model: string;
  providerLabel: string;
  modelLabel: string;
}
export interface ReviewModelPickerModel {
  getSnapshot(): { selection: ReviewModelSelection | null; busy: boolean };
  subscribe(listener: () => void): () => void;
  selectModel(selection: ReviewModelSelection | null): void;
}

/** The normal model browser reads the canonical host provider catalog. Only selection intent is local. */
export function ReviewModelPicker({
  model,
  hostId,
  active,
}: {
  model: ReviewModelPickerModel;
  hostId: string;
  active: boolean;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const connected = useHostRuntimeIsConnected(hostId);
  const { entries, isLoading, isRefreshing, error, refetchIfStale, refresh } = useProvidersSnapshot(
    hostId,
    { enabled: active },
  );
  const providers = useMemo(() => {
    const choices = buildSelectableProviderSelectorProviders(entries, connected);
    const selected = state.selection;
    if (!selected) return choices;
    const row = {
      favoriteKey: `${selected.provider}:${selected.model}`,
      provider: selected.provider,
      providerLabel: selected.providerLabel,
      modelId: selected.model,
      modelLabel: selected.modelLabel,
    };
    const captured: ProviderSelectorProvider = {
      id: selected.provider,
      label: selected.providerLabel,
      modelSelection: { kind: "models", rows: [row] },
    };
    const index = choices.findIndex((choice) => choice.id === selected.provider);
    if (index < 0) return [...choices, captured];
    const existing = choices[index].modelSelection;
    const rows =
      existing.kind === "models"
        ? existing.rows.filter((item) => item.modelId !== selected.model)
        : [];
    const next = [...choices];
    next[index] = { ...captured, modelSelection: { kind: "models", rows: [row, ...rows] } };
    return next;
  }, [entries, state.selection, connected]);
  const select = useCallback(
    (provider: string, modelId: string) => {
      const entry = providers.find((item) => item.id === provider);
      const row =
        entry?.modelSelection.kind === "models"
          ? entry.modelSelection.rows.find((item) => item.modelId === modelId)
          : null;
      if (entry && row)
        model.selectModel({
          provider,
          model: modelId,
          providerLabel: entry.label,
          modelLabel: row.modelLabel,
        });
    },
    [model, providers],
  );
  const automatic = useCallback(() => model.selectModel(null), [model]);
  const open = useCallback(() => {
    refetchIfStale();
  }, [refetchIfStale]);
  const retry = useCallback(
    (provider: string) => {
      void refresh([provider]);
    },
    [refresh],
  );
  return (
    <View style={styles.contentGap}>
      <Field label="Preferred model">
        <CombinedModelSelector
          providers={providers}
          selectedProvider={state.selection?.provider ?? ""}
          selectedModel={state.selection?.model ?? ""}
          onSelect={select}
          isLoading={isLoading}
          disabled={state.busy}
          serverId={hostId}
          onOpen={open}
          onRetryProvider={retry}
          isRetryingProvider={isRefreshing}
        />
      </Field>
      {state.selection ? (
        <Button onPress={automatic} disabled={state.busy} variant="outline" size="sm">
          Use host generation defaults
        </Button>
      ) : null}
      {error ? <Alert variant="error" description={error} /> : null}
    </View>
  );
}
