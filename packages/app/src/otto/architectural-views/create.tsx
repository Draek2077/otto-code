import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useFetchQuery } from "@/data/query";
import { SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import {
  ViewKind,
  createViewDraft,
  readViewSources,
  type ViewDraft,
  type ViewScope,
  type ViewReference,
} from "@getpaseo/plugin/otto/architectural-views";
import { CreateViewModel } from "./create-model";
import { useViewClient, unwrapView } from "./data";
import { ViewTextField } from "./fields";
import { styles } from "./styles";
const kinds = ViewKind.options.map((value) => ({
  value,
  label: value[0]!.toUpperCase() + value.slice(1),
}));
function SourceItem({
  reference,
  remove,
}: {
  reference: ViewReference;
  remove(reference: ViewReference): void;
}) {
  const press = useCallback(() => remove(reference), [reference, remove]);
  return (
    <View style={styles.row}>
      <Text style={styles.text}>{`${reference.kind}: ${reference.id}`}</Text>
      <Button variant="ghost" size="sm" onPress={press}>
        Remove source
      </Button>
    </View>
  );
}
export function CreateView({
  scope,
  reference,
  active,
  created,
  close,
}: {
  scope: ViewScope;
  reference?: ViewReference;
  active: boolean;
  created(draft: ViewDraft): void;
  close(): void;
}) {
  const [model] = useState(() => new CreateViewModel(reference)),
    state = useSyncExternalStore(model.subscribe, model.getSnapshot),
    client = useViewClient(scope.hostId);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const sources = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 2000,
    queryKey: ["ottoViews", scope.hostId, scope.target.kind, scope.target.id, "sources", query],
    enabled: active,
    retry: false,
    queryFn: async () => unwrapView(await client.call(readViewSources, { scope, query })),
  });
  const options = useMemo(
    () => [
      { value: "", label: "Add a Knowledge source" },
      ...(sources.data?.sources ?? []).map((entry) => ({
        value: JSON.stringify(entry.reference),
        label: `${entry.title} (${entry.status})`,
      })),
    ],
    [sources.data],
  );
  const title = useCallback((value: string) => model.title(value), [model]);
  const kind = useCallback(
    (value: string) => {
      const parsed = ViewKind.safeParse(value);
      if (parsed.success) model.kind(parsed.data);
    },
    [model],
  );
  const add = useCallback(
    (value: string) => {
      const entry = sources.data?.sources.find(
        (candidate) => JSON.stringify(candidate.reference) === value,
      );
      if (entry) model.add(entry.reference);
    },
    [model, sources.data],
  );
  const remove = useCallback((value: ViewReference) => model.remove(value), [model]);
  const submit = useCallback(async () => {
    const draft = await model.create(async (input) =>
      unwrapView(await client.call(createViewDraft, { ...input, scope })),
    );
    if (draft) created(draft);
  }, [model, client, scope, created]);
  return (
    <View style={styles.card} testID="architectural-view-create">
      <Text style={styles.title}>New Architectural View</Text>
      <ViewTextField label="Title" value={state.title} change={title} disabled={state.busy} />
      <SettingsSelect
        label="Diagram"
        value={state.diagramType}
        options={kinds}
        onValueChange={kind}
        disabled={state.busy}
      />
      <ViewTextField
        label="Find Knowledge sources"
        value={query}
        change={setQuery}
        disabled={state.busy}
      />
      <SettingsSelect
        label="Knowledge sources"
        value=""
        options={options}
        onValueChange={add}
        disabled={state.busy}
      />
      {state.references.map((entry) => (
        <SourceItem key={JSON.stringify(entry)} reference={entry} remove={remove} />
      ))}
      {sources.error ? <Alert variant="error" description={sources.error.message} /> : null}
      {state.error ? <Alert variant="error" description={state.error} /> : null}
      {state.blocked ? (
        <Alert
          variant="warning"
          description={`Inspect draft ${model.draftId} in the library before creating another.`}
        />
      ) : null}
      <View style={styles.row}>
        <Button onPress={submit} disabled={!active || state.busy || state.blocked}>
          Create draft
        </Button>
        <Button variant="outline" onPress={close} disabled={state.busy}>
          Close
        </Button>
      </View>
    </View>
  );
}
