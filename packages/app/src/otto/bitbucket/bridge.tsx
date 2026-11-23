import React, { lazy, Suspense, type ReactNode } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsRow } from "@/components/settings";
import { useHostFeature } from "@/runtime/host-features";
const Settings = lazy(async () => ({
  default: (await import("./settings")).BitbucketHostSettings,
}));
const loading = <SettingsRow label="Loading Bitbucket…" />;
export function BitbucketAvailable({ hostId, children }: { hostId: string; children: ReactNode }) {
  // COMPAT(ottoBitbucket): added v0.10.0; drop gate when host floor >= v0.10.0, after 2027-04-30.
  const available = useHostFeature(hostId, "ottoBitbucket");
  return available ? (
    <Suspense fallback={loading}>{children}</Suspense>
  ) : (
    <SettingsRow label="Update the host to use Bitbucket." />
  );
}
export function BitbucketSettings(props: PluginSurfaceProps) {
  return (
    <BitbucketAvailable hostId={props.host.id}>
      <Settings {...props} />
    </BitbucketAvailable>
  );
}
