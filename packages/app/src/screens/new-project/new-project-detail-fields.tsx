import { useCallback } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { NewProjectField, NewProjectSwitchRow, NewProjectTextInput } from "./new-project-inputs";
import type { NewProjectFormState } from "./new-project-form";

// The text fields a mode needs beyond the folder path. Everything selectable
// lives in the badge row above the input; only free text lands here, so the
// column stays short whichever mode is active.

export type NewProjectFieldUpdate = <K extends keyof NewProjectFormState>(
  key: K,
  value: NewProjectFormState[K],
) => void;

interface NewProjectDetailFieldsProps {
  form: NewProjectFormState;
  disabled: boolean;
  onUpdate: NewProjectFieldUpdate;
}

export function NewProjectDetailFields({ form, disabled, onUpdate }: NewProjectDetailFieldsProps) {
  const { t } = useTranslation();

  const setFolderName = useCallback((value: string) => onUpdate("folderName", value), [onUpdate]);
  const setCloneUrl = useCallback((value: string) => onUpdate("cloneUrl", value), [onUpdate]);
  const setInitialBranch = useCallback(
    (value: string) => onUpdate("initialBranch", value),
    [onUpdate],
  );
  const setRemoteName = useCallback((value: string) => onUpdate("remoteName", value), [onUpdate]);
  const setAddReadme = useCallback((value: boolean) => onUpdate("addReadme", value), [onUpdate]);

  if (form.mode === "open") {
    return null;
  }

  const isClone = form.mode === "clone";
  const showRepoSetup = !isClone && form.gitSetup !== "none";

  return (
    <View style={styles.fields}>
      {isClone ? (
        <NewProjectField label={t("newProject.fields.cloneUrl")}>
          <NewProjectTextInput
            value={form.cloneUrl}
            onChangeText={setCloneUrl}
            placeholder={t("newProject.fields.cloneUrlPlaceholder")}
            editable={!disabled}
            testID="new-project-clone-url-input"
          />
        </NewProjectField>
      ) : null}

      <NewProjectField
        label={
          isClone ? t("newProject.fields.folderNameOptional") : t("newProject.fields.folderName")
        }
      >
        <NewProjectTextInput
          value={form.folderName}
          onChangeText={setFolderName}
          placeholder={
            isClone
              ? t("newProject.fields.folderNameFromUrl")
              : t("newProject.fields.folderNamePlaceholder")
          }
          editable={!disabled}
          testID="new-project-folder-name-input"
        />
      </NewProjectField>

      {showRepoSetup ? (
        <>
          <NewProjectField label={t("newProject.fields.initialBranch")}>
            <NewProjectTextInput
              value={form.initialBranch}
              onChangeText={setInitialBranch}
              placeholder={t("newProject.fields.initialBranchPlaceholder")}
              editable={!disabled}
              testID="new-project-initial-branch-input"
            />
          </NewProjectField>

          {form.gitSetup === "remote" ? (
            <NewProjectField label={t("newProject.fields.repositoryName")}>
              <NewProjectTextInput
                value={form.remoteName}
                onChangeText={setRemoteName}
                // Empty means "same as the folder", so the placeholder shows
                // what will actually be created rather than a generic hint.
                placeholder={form.folderName || t("newProject.fields.repositoryNamePlaceholder")}
                editable={!disabled}
                testID="new-project-repository-name-input"
              />
            </NewProjectField>
          ) : null}

          <NewProjectSwitchRow
            label={t("newProject.fields.addReadme")}
            value={form.addReadme}
            onValueChange={setAddReadme}
            disabled={disabled}
            testID="new-project-add-readme"
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fields: {
    gap: theme.spacing[3],
  },
}));
