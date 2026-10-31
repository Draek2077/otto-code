import { useCallback, useSyncExternalStore } from "react";
import { Alert } from "@/components/ui/alert";
import { SettingsSection, SettingsCard, SettingsSwitch, SettingsRow } from "@/components/settings";
import { useWakePreferences } from "./use-preferences";
import { useWakeCapability } from "./use-capability";
import { getWakeStatus, subscribeWakeStatus } from "./status";
import { WakeWordTuning } from "./tuning";
export function WakeWordSettings() {
  const capability = useWakeCapability();
  const { settings, save, error } = useWakePreferences();
  const status = useSyncExternalStore(subscribeWakeStatus, getWakeStatus);
  const enable = useCallback(
    (value: boolean) => save({ wakeWordEnabled: value, wakeWordListeningPaused: false }),
    [save],
  );
  const autoSend = useCallback((value: boolean) => save({ wakeWordAutoSend: value }), [save]);
  return (
    <SettingsSection
      title="Hey Otto"
      info="Opt-in listening on this device. Idle audio stays local. A detected phrase starts one dictation in the active chat. Android listens only while Otto is in the foreground."
    >
      {error ? <Alert variant="error" description={error} /> : null}
      <SettingsCard>
        <SettingsSwitch
          label="Enable Hey Otto"
          value={settings.wakeWordEnabled}
          onValueChange={enable}
          disabled={!capability.available}
          hint={
            capability.reason ??
            "Off by default. Microphone permission is requested only when listening starts in a chat."
          }
        />
        <SettingsRow
          label="Listening status"
          hint={
            status.error ||
            (settings.wakeWordEnabled
              ? "Return to a connected chat to listen. The microphone icon pauses or resumes detection."
              : "Listening is off; the detector does not request microphone access.")
          }
        />
        <SettingsSwitch
          label="Send after dictation"
          value={settings.wakeWordAutoSend}
          onValueChange={autoSend}
          disabled={!capability.available}
          hint="Off inserts the transcript for review. On explicitly sends the detected command after silence."
        />
        <WakeWordTuning disabled={!capability.available} />
      </SettingsCard>
    </SettingsSection>
  );
}
