import { SettingsCard, SettingsCollapsibleRow, SettingsSection } from "@/components/settings";
import type { BrainSettingsMode } from "./contracts";
import { useBrainSettings } from "./context";
import { CredentialField } from "./credentials";
import { ConnectionSelect, ConnectionText, ConnectionToggle } from "./fields";
import { DomainActions, DomainNotice } from "./domain-actions";
import { SettingsRows } from "./rows";

const MODES: readonly { value: BrainSettingsMode; label: string }[] = [
  { value: "local", label: "Local Brain" },
  { value: "remote", label: "Remote Brain" },
];

function RemoteConnectionFields() {
  const { state, snapshot } = useBrainSettings();
  const connection = state.connection;
  if (!connection) return null;
  return (
    <SettingsRows>
      <ConnectionText field="remoteHost" label="Remote Brain hostname" />
      <ConnectionText field="remotePort" label="Remote Brain port" />
      <ConnectionToggle field="remoteSecure" label="Use HTTPS" />
      {connection.draft.remoteSecure ? (
        <ConnectionText field="remoteFingerprint" label="SHA-256 certificate fingerprint" />
      ) : null}
      <CredentialField
        slot="remote"
        label="Remote Brain token"
        status={snapshot.connection.data?.credential ?? connection.origin.credential}
        writable={snapshot.capabilities.remoteCredential}
      />
    </SettingsRows>
  );
}

export function ConnectionSection() {
  const { state, snapshot } = useBrainSettings();
  const connection = state.connection;
  if (!connection) return null;
  const invalidRemote =
    Object.keys(state.connectionErrors).length > 0 || state.credentialErrors.remote !== undefined;
  return (
    <SettingsSection title={`Connection on ${snapshot.host.label}`}>
      <DomainNotice scope="connection" />
      <SettingsCard>
        {snapshot.capabilities.remoteConnection ? (
          <ConnectionSelect label="Brain location" options={MODES} />
        ) : null}
        <ConnectionToggle field="enabled" label="Enable Brain" />
        {connection.draft.mode === "local" ? (
          <ConnectionToggle
            field="autoStart"
            label="Start with host"
            hint="Starts Brain with the owning host when Enable Brain is also on"
          />
        ) : null}
        {connection.draft.mode === "remote" ? <RemoteConnectionFields /> : null}
        {connection.draft.mode === "local" && snapshot.capabilities.remoteConnection ? (
          <SettingsCollapsibleRow
            key={invalidRemote ? "invalid-remote" : "remote"}
            label="Advanced saved Remote Brain connection"
            defaultExpanded={invalidRemote}
          >
            <RemoteConnectionFields />
          </SettingsCollapsibleRow>
        ) : null}
      </SettingsCard>
      <DomainActions scope="connection" />
    </SettingsSection>
  );
}
