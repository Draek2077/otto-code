import { useCallback, useMemo } from "react";
import {
  SettingsAction,
  SettingsCard,
  SettingsCollapsibleRow,
  SettingsSection,
} from "@/components/settings";
import type { BrainTlsMode } from "./contracts";
import { useBrainSettings, useSettingsDisabled } from "./context";
import { CredentialField, GenerateAccessKey, AccessKeyReveal } from "./credentials";
import { OwnerSelect, OwnerText, OwnerToggle, ValueRow } from "./fields";
import { SettingsSelect } from "@/components/settings";
import { SettingsRows } from "./rows";
import { currentOwnerFacts } from "./presentation";

const AUTH: readonly { value: "none" | "token"; label: string }[] = [
  { value: "token", label: "Access key required" },
  { value: "none", label: "No access key" },
];
const TLS: readonly { value: BrainTlsMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "files", label: "Certificate files" },
  { value: "self-signed", label: "Self-signed" },
  { value: "tailscale", label: "Tailscale" },
];

function BindAddresses() {
  const { state, model, snapshot } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const choices = useMemo(() => {
    const combined = [...snapshot.choices.bindAddresses, ...(state.discovery?.addresses ?? [])];
    return combined
      .filter((choice, index) => combined.findIndex((other) => other.id === choice.id) === index)
      .map((choice) => ({ value: choice.id, label: choice.label }));
  }, [snapshot.choices.bindAddresses, state.discovery?.addresses]);
  const change = useCallback((value: string) => model.editOwner("listenHost", value), [model]);
  if (!state.owner || choices.length === 0) return null;
  return (
    <SettingsSelect
      label="Listen interface"
      value={state.owner.draft.listenHost}
      options={choices}
      onValueChange={change}
      disabled={busy || !snapshot.capabilities.access}
    />
  );
}

function NetworkDiscovery() {
  const { model, state, snapshot } = useBrainSettings();
  const busy = useSettingsDisabled("owner");
  const discover = useCallback(() => {
    void model.discoverNetwork();
  }, [model]);
  const apply = useCallback(() => model.applyDiscoveredTls(), [model]);
  if (!snapshot.capabilities.discoverNetwork) return null;
  return (
    <SettingsRows>
      <SettingsAction
        label="Discover owner network"
        actionLabel={state.operation === "discover" ? "Detecting..." : "Detect"}
        onPress={discover}
        disabled={busy}
      />
      {state.discovery ? (
        <ValueRow
          label="Tailscale"
          value={
            state.discovery.tailscale.available
              ? (state.discovery.tailscale.hostname ?? "Available")
              : "Not available on this owner"
          }
        />
      ) : null}
      {state.discovery?.tailscale.available && snapshot.capabilities.tls ? (
        <SettingsAction
          label="Use detected certificate settings"
          actionLabel="Use detected settings"
          onPress={apply}
          disabled={busy}
        />
      ) : null}
    </SettingsRows>
  );
}

function TlsFields() {
  const { state, snapshot } = useBrainSettings();
  const owner = state.owner;
  if (!owner) return null;
  const disabled = !snapshot.capabilities.tls;
  const mode = owner.draft.tlsMode;
  return (
    <SettingsRows>
      <OwnerSelect field="tlsMode" label="HTTPS" options={TLS} disabled={disabled} />
      {mode === "files" ? (
        <>
          <OwnerText field="certFile" label="Certificate file" disabled={disabled} />
          <OwnerText field="keyFile" label="Private key file" disabled={disabled} />
        </>
      ) : null}
      {mode === "self-signed" || mode === "tailscale" ? (
        <>
          <OwnerText field="hostname" label="Certificate hostname" disabled={disabled} />
          <OwnerText
            field="certDirectory"
            label="Certificate directory override"
            disabled={disabled}
          />
          <ValueRow
            label="Resolved certificate directory"
            value={
              currentOwnerFacts(snapshot, owner.origin).resolved.certificateDirectory ??
              "Not reported"
            }
          />
          <OwnerText field="renewBeforeDays" label="Renew before (days)" disabled={disabled} />
          <OwnerText
            field="checkIntervalMs"
            label="Certificate check interval (ms)"
            disabled={disabled}
          />
        </>
      ) : null}
      {mode === "tailscale" ? (
        <OwnerText
          field="tailscaleExecutable"
          label="Tailscale executable on owner"
          disabled={disabled}
        />
      ) : null}
    </SettingsRows>
  );
}

export function SecuritySection() {
  const { state, snapshot } = useBrainSettings();
  const owner = state.owner?.origin;
  const capability = snapshot.capabilities;
  if (!owner) return null;
  const facts = currentOwnerFacts(snapshot, owner);
  const invalidAccess =
    state.ownerErrors.listenHost !== undefined || state.ownerErrors.listenPort !== undefined;
  const invalidTls =
    state.ownerErrors.certFile !== undefined ||
    state.ownerErrors.keyFile !== undefined ||
    state.ownerErrors.renewBeforeDays !== undefined ||
    state.ownerErrors.checkIntervalMs !== undefined;
  return (
    <>
      {capability.supported.access ? (
        <SettingsSection
          title="Sharing and access"
          info={`Configure how Brain on ${owner.owner.label} accepts connections. Open network access requires the explicit Allow access without a key setting.`}
        >
          <SettingsCard>
            <CredentialField
              slot="access"
              label="Access key"
              status={facts.credentials.access}
              writable={capability.accessCredential}
            />
            <GenerateAccessKey />
            <AccessKeyReveal />
            <SettingsCollapsibleRow
              key={invalidAccess ? "invalid-access" : "access"}
              label="Advanced network access"
              defaultExpanded={invalidAccess}
            >
              <BindAddresses />
              <OwnerText
                field="listenHost"
                label="Listen address on owner"
                disabled={!capability.access}
              />
              <OwnerText field="listenPort" label="Listen port" disabled={!capability.access} />
              <OwnerSelect
                field="authMode"
                label="Access"
                options={AUTH}
                disabled={!capability.access}
              />
              <OwnerToggle
                field="allowInsecureBind"
                label="Allow access without a key"
                disabled={!capability.access}
              />
              <OwnerToggle
                field="allowRemoteConfig"
                label="Allow remote configuration"
                disabled={!capability.access}
              />
              <NetworkDiscovery />
            </SettingsCollapsibleRow>
          </SettingsCard>
        </SettingsSection>
      ) : null}
      {capability.supported.tls ? (
        <SettingsSection
          title="Security"
          info={`Certificate and executable paths are on ${owner.owner.label}. The owner validates and applies these settings.`}
        >
          <SettingsCard>
            <SettingsCollapsibleRow
              key={invalidTls ? "invalid-tls" : "tls"}
              label="Advanced HTTPS and certificates"
              defaultExpanded={invalidTls}
            >
              <TlsFields />
            </SettingsCollapsibleRow>
          </SettingsCard>
        </SettingsSection>
      ) : null}
      {capability.supported.storage || capability.huggingFaceCredential ? (
        <SettingsSection title="Download credentials">
          <SettingsCard>
            <CredentialField
              slot="huggingFace"
              label="Hugging Face token"
              status={facts.credentials.huggingFace}
              writable={capability.huggingFaceCredential}
            />
          </SettingsCard>
        </SettingsSection>
      ) : null}
    </>
  );
}
