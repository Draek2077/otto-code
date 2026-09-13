import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProjectPickerBrowseButton } from "@/components/project-picker-browse-button";
import { toErrorMessage } from "@/utils/error-messages";

/** This replaces the workspace/settings runtime while its project is Offline. */
export function OfflineProjectPanel({
  serverId,
  projectId,
  projectName,
  rootPath,
}: {
  serverId: string;
  projectId: string;
  projectName: string;
  rootPath: string;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  // COMPAT(projectRelocation): added in v0.9.10, remove after 2027-03-13 when floor >= v0.9.10.
  const supported = useHostFeature(serverId, "projectRelocation");
  const [folder, setFolder] = useState(rootPath);
  const [resetKey, setResetKey] = useState(0);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const relocation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Host is disconnected.");
      await client.relocateProject(projectId, rootPath, folder.trim());
    },
  });
  const reconnect = useCallback(() => relocation.mutate(), [relocation]);
  const selectFolder = useCallback((value: string) => {
    setFolder(value);
    setResetKey((key) => key + 1);
    setPickerError(null);
  }, []);
  const onPickerError = useCallback(() => setPickerError("Could not open the folder picker."), []);
  const error = relocation.error ? toErrorMessage(relocation.error) : pickerError;
  return (
    <View style={styles.container} testID="project-offline-panel">
      <View style={styles.header}>
        <Text style={styles.title}>{projectName}</Text>
        <StatusBadge
          label={t("project.offline.state", { defaultValue: "Offline" })}
          variant="warning"
        />
      </View>
      <Text style={styles.hint}>
        {t("project.offline.explanation", {
          defaultValue:
            "The base folder is unavailable. Your workspaces and chats are preserved. Select its current location to reconnect this project.",
        })}
      </Text>
      {supported ? (
        <View style={styles.fields}>
          <Field
            label={t("project.offline.baseFolder", { defaultValue: "Base folder" })}
            error={error}
          >
            <FormTextInput
              testID="project-base-folder"
              accessibilityLabel="Base folder"
              size="sm"
              initialValue={folder}
              resetKey={resetKey}
              onChangeText={setFolder}
              editable={!relocation.isPending}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
          <View style={styles.actions}>
            <ProjectPickerBrowseButton
              serverId={serverId}
              onSelect={selectFolder}
              onError={onPickerError}
              disabled={relocation.isPending}
            />
            <Button
              size="sm"
              onPress={reconnect}
              loading={relocation.isPending}
              disabled={!folder.trim() || !client}
              testID="project-reconnect"
            >
              {t("project.offline.reconnect", { defaultValue: "Reconnect project" })}
            </Button>
          </View>
        </View>
      ) : (
        <Text style={styles.hint}>Update the host to reconnect this project.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, padding: theme.spacing[4], gap: theme.spacing[4] },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  title: { flexShrink: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, maxWidth: 560 },
  fields: { gap: theme.spacing[3], maxWidth: 560 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
