import { useCallback, useRef, useState } from "react";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useZoomRecorderStatus } from "./use-status";

export function ZoomRecorderSettings() {
  const { bridge, status } = useZoomRecorderStatus();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const change = useCallback(async (operation: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await operation();
    } catch {
      setError("Could not update Zoom Recorder.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);
  const enable = useCallback(
    (enabled: boolean) => {
      if (bridge) void change(() => (enabled ? bridge.enable() : bridge.disable()));
    },
    [bridge, change],
  );
  const deleteModel = useCallback(() => {
    if (!bridge) return;
    void change(async () => {
      if (
        await confirmDialog({
          title: "Delete downloaded model?",
          message: "Zoom recording will be turned off. Your meeting notes are kept.",
          confirmLabel: "Delete model",
          destructive: true,
        })
      )
        await bridge.deleteModel();
    });
  }, [bridge, change]);
  if (!bridge || !status?.available) return null;
  return (
    <SettingsSection title="Meetings">
      {error ? <Alert variant="error" description={error} /> : null}
      <SettingsCard>
        <SettingsSwitch
          label="Record Zoom meetings"
          hint="Records and transcribes Zoom audio on this computer when enabled."
          value={status.enabled}
          disabled={pending}
          onValueChange={enable}
        />
        <SettingsRow label="Recorder status" hint={status.detail} />
        {status.modelBytes > 0 ? (
          <SettingsRow
            label="Downloaded model"
            hint={`${Math.round(status.modelBytes / (1024 * 1024))} MB`}
          >
            <Button variant="destructive" disabled={pending} onPress={deleteModel}>
              Delete model
            </Button>
          </SettingsRow>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
