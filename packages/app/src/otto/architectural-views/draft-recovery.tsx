import { useCallback, useState, useSyncExternalStore } from "react";
import { ScrollView, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { ViewDraftModel } from "./draft-model";
import { forgetViewDraft } from "./drafts";
import { styles } from "./styles";
/** Local bytes remain recoverable even when a peer publishes/discards the saved
 * draft. This surface never implies that those bytes are still a canonical draft. */
export function LocalViewDraftRecovery({
  model,
  active,
  close,
}: {
  model: ViewDraftModel;
  active: boolean;
  close(): void;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const cache = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const copy = useCallback(async () => {
    try {
      await copyToClipboard(state.text);
      setNotice("Local specification copied.");
    } catch {
      setNotice("Copy failed. Select the specification below to preserve it.");
    }
  }, [state.text]);
  const discard = useCallback(async () => {
    if (
      state.busy ||
      !(await confirmDialog({
        title: "Discard local View edits?",
        message:
          "This clears only the retained local edits. Saved Views and revisions are unchanged.",
        confirmLabel: "Discard local edits",
        destructive: true,
      }))
    )
      return;
    if (model.getSnapshot() !== state) return;
    forgetViewDraft(cache, model);
    close();
  }, [state, model, cache, close]);
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Alert
        variant="warning"
        description="The saved draft is unavailable. Your local edits are retained here; copy them before clearing this recovery draft."
      />
      <Text style={styles.title}>{state.title}</Text>
      <View style={styles.row}>
        <Button onPress={copy} disabled={!active}>
          Copy local specification
        </Button>
        <Button variant="outline" onPress={discard} disabled={!active || state.busy}>
          Discard local edits
        </Button>
      </View>
      {notice ? <Text style={styles.muted}>{notice}</Text> : null}
      <Text selectable style={styles.text}>
        {state.text}
      </Text>
    </ScrollView>
  );
}
