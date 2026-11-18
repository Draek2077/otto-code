import { useCallback } from "react";
import { SettingsRow } from "@/components/settings";
import { Switch } from "@/components/ui/switch";
import { useHostFeature } from "@/runtime/host-features";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
export function WriterSetting({ serverId }: { serverId: string }) {
  const supported = useHostFeature(serverId, "ottoAgentTeams");
  const { config, patchConfig } = useDaemonConfig(supported ? serverId : null);
  const toast = useToast();
  const change = useCallback(
    (enabled: boolean) => {
      void patchConfig({ metadataGeneration: { preferWriterProfiles: enabled } }).catch((e) =>
        toast.error(toErrorMessage(e)),
      );
    },
    [patchConfig, toast],
  );
  if (!supported || !config) return null;
  return (
    <SettingsRow
      label="Prefer Writer Profiles"
      hint="Try the active team's Writers first when generating short text."
    >
      <Switch
        accessibilityLabel="Prefer Writer Profiles"
        value={config.metadataGeneration.preferWriterProfiles === true}
        onValueChange={change}
      />
    </SettingsRow>
  );
}
