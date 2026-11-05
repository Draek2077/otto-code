import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { LiveFileModel } from "@/file-pane/live-file/model";
import { createMissingSourceFile } from "./create-file";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
/** Only the watcher can establish absence. Error-message text is never treated
 * as permission to create or overwrite a file. Paseo creates with exclusive wx. */
export function EditorMissingFile({
  client,
  target,
  model,
  refresh,
}: {
  client: DaemonClient;
  target: { cwd: string; path: string };
  model: LiveFileModel;
  refresh(): void;
}) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const retained = useRetainedPanelActive(),
    visible = useAppVisible();
  const active = retained && visible;
  const authority = useRef({ active: false }),
    pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const activation = { active };
    authority.current = activation;
    return () => {
      activation.active = false;
    };
  }, [active]);
  const create = useCallback(async () => {
    if (pending.current || !active || model.getSnapshot().observation?.status !== "missing") return;
    const generation = authority.current;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (
        !(await confirmDialog({
          title: "Create this file?",
          message: target.path,
          confirmLabel: "Create file",
        }))
      )
        return;
      if (
        !generation.active ||
        generation !== authority.current ||
        model.getSnapshot().observation?.status !== "missing"
      )
        return;
      await createMissingSourceFile((input) => client.createFileEntry(input), target);
      if (generation.active && generation === authority.current) refresh();
    } catch (failure) {
      if (generation.active && generation === authority.current)
        setError(failure instanceof Error ? failure.message : "File creation failed.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [active, client, target, model, refresh]);
  if (snapshot.observation?.status !== "missing") return null;
  return (
    <View>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Button
        variant="outline"
        size="sm"
        onPress={create}
        loading={busy}
        testID="editor-create-missing-file"
      >
        Create missing file
      </Button>
    </View>
  );
}
