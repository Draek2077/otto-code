import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { TextFieldPicker, type ComboboxOption } from "@/components/ui/text-field-picker";

// Common shell binaries — still fully freeform via allowCustomValue, since a
// custom wrapper script or an uncommon shell path is entirely valid too.
const SHELL_COMMAND_PRESETS: ComboboxOption[] = [
  { id: "bash", label: "bash" },
  { id: "zsh", label: "zsh" },
  { id: "fish", label: "fish" },
  { id: "pwsh", label: "PowerShell (pwsh)" },
  { id: "cmd.exe", label: "Command Prompt (cmd.exe)" },
  { id: "/bin/bash", label: "/bin/bash" },
  { id: "/opt/homebrew/bin/fish", label: "/opt/homebrew/bin/fish (Homebrew fish)" },
];

export interface ProfileDraft {
  name: string;
  command: string;
  args: string;
}

interface FieldErrors {
  name?: string;
  command?: string;
}

interface TerminalProfileEditModalProps {
  visible: boolean;
  title: string;
  initialDraft: ProfileDraft;
  onClose: () => void;
  onSave: (draft: ProfileDraft) => Promise<void>;
  testID?: string;
}

export function TerminalProfileEditModal({
  visible,
  title,
  initialDraft,
  onClose,
  onSave,
  testID,
}: TerminalProfileEditModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialDraft.name);
  const [command, setCommand] = useState(initialDraft.command);
  const [args, setArgs] = useState(initialDraft.args);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const nameInputRef = useRef<TextInput>(null);
  const argsInputRef = useRef<TextInput>(null);

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    setFieldErrors((current) => ({ ...current, name: undefined }));
  }, []);

  const handleCommandChange = useCallback((value: string) => {
    setCommand(value);
    setFieldErrors((current) => ({ ...current, command: undefined }));
    argsInputRef.current?.focus();
  }, []);

  const handleArgsChange = useCallback((value: string) => {
    setArgs(value);
  }, []);

  const sheetHeader = useMemo<SheetHeader>(() => ({ title }), [title]);

  useEffect(() => {
    if (!visible) {
      setIsPending(false);
      return;
    }
    setName(initialDraft.name);
    setCommand(initialDraft.command);
    setArgs(initialDraft.args);
    setFieldErrors({});
    setSubmitError(null);
    setIsPending(false);

    const timeout = setTimeout(() => {
      nameInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timeout);
  }, [visible, initialDraft.name, initialDraft.command, initialDraft.args]);

  const validate = useCallback((): boolean => {
    const errors: FieldErrors = {};
    if (name.trim().length === 0) {
      errors.name = t("settings.host.terminalProfiles.nameRequired");
    }
    if (command.trim().length === 0) {
      errors.command = t("settings.host.terminalProfiles.commandRequired");
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [command, name, t]);

  const handleSave = useCallback(async () => {
    if (isPending) return;
    setSubmitError(null);

    if (!validate()) {
      return;
    }

    setIsPending(true);
    try {
      await onSave({ name: name.trim(), command: command.trim(), args });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("common.errors.unableToSave"));
    } finally {
      setIsPending(false);
    }
  }, [args, command, isPending, name, onClose, onSave, t, validate]);

  const handleCancel = useCallback(() => {
    if (isPending) return;
    onClose();
  }, [isPending, onClose]);

  const handleArgsSubmit = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const nameError = fieldErrors.name;
  const commandError = fieldErrors.command;

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          variant="secondary"
          style={styles.footerButton}
          onPress={handleCancel}
          disabled={isPending}
          testID="terminal-profile-cancel-button"
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          style={styles.footerButton}
          onPress={handleSave}
          disabled={isPending}
          testID="terminal-profile-save-button"
        >
          {isPending
            ? t("settings.host.terminalProfiles.saving")
            : t("settings.host.terminalProfiles.save")}
        </Button>
      </View>
    ),
    [handleCancel, handleSave, isPending, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      header={sheetHeader}
      onClose={handleCancel}
      footer={footer}
      testID={testID}
      desktopMaxWidth={480}
    >
      <View style={styles.body}>
        <Field
          label={t("settings.host.terminalProfiles.nameLabel")}
          error={nameError}
          testID="terminal-profile-name-field"
        >
          <FormTextInput
            ref={nameInputRef}
            initialValue={initialDraft.name}
            resetKey={visible ? "open" : "closed"}
            onChangeText={handleNameChange}
            placeholder={t("settings.host.terminalProfiles.namePlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isPending}
            returnKeyType="done"
            nativeID="terminal-profile-name-input"
            accessibilityLabel={t("settings.host.terminalProfiles.nameLabel")}
            testID="terminal-profile-name-input"
          />
        </Field>

        <Field
          label={t("settings.host.terminalProfiles.commandLabel")}
          error={commandError}
          testID="terminal-profile-command-field"
        >
          <TextFieldPicker
            value={command}
            onChange={handleCommandChange}
            options={SHELL_COMMAND_PRESETS}
            placeholder={t("settings.host.terminalProfiles.commandPlaceholder")}
            testID="terminal-profile-command-input"
          />
        </Field>

        <Field
          label={t("settings.host.terminalProfiles.argsLabel")}
          hint={t("settings.host.terminalProfiles.argsHint")}
          testID="terminal-profile-args-field"
        >
          <FormTextInput
            ref={argsInputRef}
            initialValue={initialDraft.args}
            resetKey={visible ? "open" : "closed"}
            onChangeText={handleArgsChange}
            placeholder={t("settings.host.terminalProfiles.argsPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isPending}
            returnKeyType="done"
            onSubmitEditing={handleArgsSubmit}
            nativeID="terminal-profile-args-input"
            accessibilityLabel={t("settings.host.terminalProfiles.argsLabel")}
            testID="terminal-profile-args-input"
          />
        </Field>

        {submitError ? (
          <Text style={styles.submitError} testID="terminal-profile-submit-error">
            {submitError}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
  submitError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
