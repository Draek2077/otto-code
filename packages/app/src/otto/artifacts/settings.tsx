import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  artifactHostDefaults,
  setArtifactHostDefaults,
  readArtifactStorage,
  setArtifactStorage,
  type ArtifactScope,
} from "@getpaseo/plugin/otto/artifacts";
import { useFetchQuery } from "@/data/query";
import { SettingsCard, SettingsRow, SettingsSelect, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  ArtifactStorageForm,
  type ArtifactStorageSeed,
  type ArtifactStorageValue,
} from "./storage-model";
import { styles } from "./styles";
const locations = [
  { value: "repository", label: "Repository (.otto/artifacts)" },
  { value: "host", label: "Selected daemon host" },
];
const projectLocations = [
  { value: "inherit", label: "Use existing repository store or host default" },
  ...locations,
];
function StoragePanel({
  seed,
  active,
  project = false,
  read,
  write,
}: {
  seed: ArtifactStorageSeed;
  active: boolean;
  project?: boolean;
  read(): Promise<ArtifactStorageSeed>;
  write(seed: ArtifactStorageSeed): Promise<string>;
}) {
  const [model] = useState(() => new ArtifactStorageForm(seed));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    if (active) return model.activate();
  }, [model, active]);
  const select = useCallback(
    (value: string) => {
      if (value === "repository" || value === "host" || value === "inherit") model.select(value);
    },
    [model],
  );
  const save = useCallback(() => {
    void model.save(write);
  }, [model, write]);
  const reload = useCallback(() => {
    void model.reload(read, () =>
      confirmDialog({
        title: "Reload Artifacts storage?",
        message:
          "Discard this local selection and reload the current saved preference? Existing artifacts will not move.",
        confirmLabel: "Reload",
        cancelLabel: "Keep draft",
      }),
    );
  }, [model, read]);
  const title = project ? "Project Artifacts storage" : "Artifacts storage default";
  return (
    <SettingsSection title={title}>
      <SettingsCard>
        <SettingsSelect
          label="New artifacts"
          hint="Independent of Knowledge, Schedules and Workflows. Changing this does not move existing files; use an artifact's Move action explicitly."
          value={state.value}
          options={project ? projectLocations : locations}
          onValueChange={select}
          disabled={state.busy}
        />
      </SettingsCard>
      <View style={styles.actions}>
        <Button variant="outline" onPress={save} disabled={state.busy || state.blocked || !active}>
          Save Artifacts storage
        </Button>
        <Button variant="ghost" onPress={reload} disabled={state.busy || !active}>
          Reload saved storage
        </Button>
      </View>
      {state.message ? <Alert description={state.message} /> : null}
      {seed.revision !== state.revision ? (
        <Alert
          variant="warning"
          description="Saved settings changed. Your local selection retains its originating revision until you explicitly reload."
        />
      ) : null}
    </SettingsSection>
  );
}
export function ArtifactDefaults({ hostId, active }: { hostId: string; active: boolean }) {
  const read = useRpc(artifactHostDefaults),
    save = useRpc(setArtifactHostDefaults);
  const readSeed = useCallback(async () => {
    const result = await read({ hostId });
    if (!result.ok) throw new Error(result.error.message);
    return { value: result.value.location, revision: result.value.revision };
  }, [read, hostId]);
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoArtifacts", hostId, "defaults"],
    enabled: active,
    retry: false,
    queryFn: readSeed,
  });
  const write = useCallback(
    async (seed: ArtifactStorageSeed) => {
      if (seed.value === "inherit") throw new Error("Host defaults cannot inherit themselves.");
      const result = await save({ hostId, expectedRevision: seed.revision, location: seed.value });
      if (!result.ok) throw new Error(result.error.message);
      await query.refetch();
      return result.value.revision;
    },
    [save, hostId, query],
  );
  if (!query.data)
    return query.error ? (
      <Alert variant="error" description={query.error.message} />
    ) : (
      <SettingsRow label="Loading Artifacts defaults..." />
    );
  return (
    <StoragePanel key={hostId} seed={query.data} active={active} read={readSeed} write={write} />
  );
}
export function ArtifactProjectStorage({
  scope,
  active,
}: {
  scope: ArtifactScope;
  active: boolean;
}) {
  const read = useRpc(readArtifactStorage),
    save = useRpc(setArtifactStorage);
  const readSeed = useCallback(async () => {
    const result = await read({ scope });
    if (!result.ok) throw new Error(result.error.message);
    return {
      value: (result.value.location ?? "inherit") as ArtifactStorageValue,
      revision: result.value.revision,
    };
  }, [read, scope]);
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoArtifacts", scope.hostId, scope.target.kind, scope.target.id, "storage"],
    enabled: active,
    retry: false,
    queryFn: readSeed,
  });
  const write = useCallback(
    async (seed: ArtifactStorageSeed) => {
      const result = await save({
        scope,
        expectedRevision: seed.revision,
        location: seed.value === "inherit" ? null : seed.value,
      });
      if (!result.ok) throw new Error(result.error.message);
      await query.refetch();
      return result.value.revision;
    },
    [save, scope, query],
  );
  const key = useMemo(() => JSON.stringify(scope), [scope]);
  if (!query.data)
    return query.error ? (
      <Alert variant="error" description={query.error.message} />
    ) : (
      <SettingsRow label="Loading project Artifacts storage..." />
    );
  return (
    <StoragePanel
      key={key}
      seed={query.data}
      active={active}
      project
      read={readSeed}
      write={write}
    />
  );
}
