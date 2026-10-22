import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { legacyStatus } from "../shared/legacy.js";

export function LegacyProviderStatus({ hostId }: { hostId: string }) {
  const read = useRpc(legacyStatus);
  const state = useQuery({
    queryKey: ["otto-legacy-providers", hostId],
    queryFn: () => read({}),
    retry: false,
  });
  const error = state.error?.message ?? state.data?.error;
  if (!error && !state.data?.providers.length) return null;
  return (
    <SettingsSection title="Preserved Otto providers">
      <SettingsCard>
        {error ? (
          <SettingsRow label={error} />
        ) : (
          state.data?.providers.map((provider) => (
            <SettingsRow
              key={provider.id}
              label={provider.label}
              hint={
                provider.diagnostic ??
                `${provider.id}: ${provider.enabled ? "using preserved host configuration" : "disabled in preserved configuration"}. Original settings and keys remain on this host.`
              }
            />
          ))
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
