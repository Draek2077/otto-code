import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { EditingTextInput } from "@/components/ui/text-input";
import type { KanbanColumn } from "@otto-code/protocol/kanban";

type CardAction = "create" | "link";

export function KanbanCardActionSheet({
  action,
  firstColumn,
  providerId,
  onClose,
  onCreate,
  onLink,
}: {
  action: CardAction;
  firstColumn: KanbanColumn | undefined;
  providerId: string;
  onClose: () => void;
  onCreate: (columnId: string, title: string, body?: string) => Promise<void>;
  onLink: (externalId: string) => Promise<void>;
}): ReactElement {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [externalId, setExternalId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCreate = action === "create";
  const canSubmit = isCreate ? Boolean(firstColumn && title.trim()) : Boolean(externalId.trim());

  const close = useCallback(() => {
    if (!pending) onClose();
  }, [onClose, pending]);
  const submit = useCallback(async () => {
    if (pending || !canSubmit) return;
    setPending(true);
    setError(null);
    try {
      if (isCreate) {
        await onCreate(firstColumn!.id, title.trim(), body.trim() || undefined);
      } else {
        await onLink(externalId.trim());
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }, [
    body,
    canSubmit,
    externalId,
    firstColumn,
    isCreate,
    onClose,
    onCreate,
    onLink,
    pending,
    title,
  ]);
  const submitPress = useCallback(() => void submit(), [submit]);
  const header = useMemo(
    () => ({ title: isCreate ? "New card" : "Link existing issue or PR" }),
    [isCreate],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="secondary" onPress={close} disabled={pending}>
          Cancel
        </Button>
        <Button
          onPress={submitPress}
          disabled={!canSubmit || pending}
          loading={pending}
          testID={isCreate ? "kanban-new-card-confirm" : "kanban-link-confirm"}
        >
          {isCreate ? "Create card" : "Link"}
        </Button>
      </View>
    ),
    [canSubmit, close, isCreate, pending, submitPress],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={close}
      desktopMaxWidth={480}
      testID={`kanban-${action}-sheet`}
      footer={footer}
    >
      {isCreate ? (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>Title</Text>
            <EditingTextInput
              style={styles.input}
              initialValue=""
              onChangeText={setTitle}
              placeholder="Card title"
              accessibilityLabel="Card title"
              editable={!pending}
              testID="kanban-new-card-input"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Description</Text>
            <EditingTextInput
              style={[styles.input, styles.description]}
              initialValue=""
              onChangeText={setBody}
              placeholder="Optional description"
              accessibilityLabel="Card description"
              editable={!pending}
              multiline
              testID="kanban-new-card-description"
            />
          </View>
          {firstColumn ? (
            <Text style={styles.hint}>New cards start in {firstColumn.name}</Text>
          ) : null}
        </>
      ) : (
        <View style={styles.field}>
          <Text style={styles.label}>{providerId === "jira" ? "Issue key" : "Issue or PR"}</Text>
          <EditingTextInput
            style={styles.input}
            initialValue=""
            onChangeText={setExternalId}
            placeholder={
              providerId === "jira" ? "For example, TEAM-123" : "GitHub URL, node ID, or number"
            }
            accessibilityLabel={providerId === "jira" ? "Jira issue key" : "GitHub issue or PR"}
            editable={!pending}
            autoCapitalize="none"
            autoCorrect={false}
            testID="kanban-link-input"
          />
          <Text style={styles.hint}>Current status determines the column</Text>
        </View>
      )}
      {error ? (
        <Text style={styles.error} testID="kanban-action-error">
          {error}
        </Text>
      ) : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: { gap: theme.spacing[2] },
  label: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  input: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  description: { minHeight: 96, textAlignVertical: "top" },
  footer: { flex: 1, flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
