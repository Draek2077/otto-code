import { useCallback, useRef, useState } from "react";
import type { SettingsInputHandle } from "@getpaseo/plugin/client/ui";
import { SettingsCollapsibleRow, SettingsInput, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useAppSettings } from "@/hooks/use-settings";
import { parseWakeTuning } from "./preferences";
const ignoreTextChange = () => {};
export function WakeWordTuning({ disabled }: { disabled: boolean }) {
  const { settings, updateSettings } = useAppSettings();
  const [initial] = useState(() => settings);
  const sensitivity = useRef<SettingsInputHandle>(null);
  const silence = useRef<SettingsInputHandle>(null);
  const phrase = useRef<SettingsInputHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const apply = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await updateSettings(
        parseWakeTuning(
          sensitivity.current?.getText() ?? "",
          silence.current?.getText() ?? "",
          phrase.current?.getText() ?? "",
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Listening tuning could not be saved. Your edits are retained.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [updateSettings]);
  return (
    <SettingsCollapsibleRow label="Listening tuning">
      <SettingsInput
        ref={phrase}
        label="Wake phrase"
        hint="The bundled model supports Hey Otto. Existing unsupported phrases stay saved until explicitly changed."
        initialValue={initial.wakeWordPhrase}
        onChangeText={ignoreTextChange}
        disabled={disabled || busy}
      />
      <SettingsInput
        ref={sensitivity}
        label="Sensitivity"
        hint="0 to 1. Higher values are easier to trigger. The original default is 0.7."
        initialValue={String(initial.wakeWordSensitivity)}
        onChangeText={ignoreTextChange}
        disabled={disabled || busy}
      />
      <SettingsInput
        ref={silence}
        label="Silence timeout (ms)"
        hint="300 to 5000 milliseconds. The original default is 1100."
        initialValue={String(initial.wakeWordSilenceTimeoutMs)}
        onChangeText={ignoreTextChange}
        disabled={disabled || busy}
      />
      {error ? <Alert variant="error" description={error} /> : null}
      <SettingsRow label="Apply listening tuning">
        <Button size="sm" onPress={apply} disabled={disabled || busy} loading={busy}>
          Apply
        </Button>
      </SettingsRow>
    </SettingsCollapsibleRow>
  );
}
