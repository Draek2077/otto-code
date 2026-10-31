import { lazy, Suspense } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsRow } from "@/components/settings";
import { useHostFeature } from "@/runtime/host-features";
const Settings = lazy(async () => ({ default: (await import("./settings")).HostSpeechSettings }));
const loading = <SettingsRow label="Loading Speech…" />;
export function SpeechSettings(props: PluginSurfaceProps) {
  // COMPAT(ottoSpeech): added v0.10.0; drop when host floor >= v0.10.0, after 2027-04-30.
  const available = useHostFeature(props.host.id, "ottoSpeech");
  return available ? (
    <Suspense fallback={loading}>
      <Settings {...props} />
    </Suspense>
  ) : (
    <SettingsRow label="Update the host to use Speech." />
  );
}
