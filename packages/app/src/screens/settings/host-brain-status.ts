import type { BrainHostStatus, MutableBrainConfig } from "@otto-code/protocol/messages";

export type BrainConnectionPhase =
  | "connected"
  | "starting"
  | "stopped"
  | "checking"
  | "disabled"
  | "unsupported"
  | "unreachable";

function urlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** The endpoint implied by the editable settings, even before it can be reached. */
export function formatConfiguredBrainEndpoint(brain: MutableBrainConfig): string {
  if (brain.mode === "remote") {
    if (!brain.remote.host.trim()) return "Not configured";
    const scheme = brain.remote.secure ? "https" : "http";
    return `${scheme}://${urlHost(brain.remote.host.trim())}:${brain.remote.port}`;
  }

  const scheme = brain.tls.mode === "off" ? "http" : "https";
  return `${scheme}://${urlHost(brain.listen.host)}:${brain.listen.port}`;
}

/** The endpoint reported by the Brain that actually answered the status probe. */
export function formatDetectedBrainEndpoint(status: BrainHostStatus): string | null {
  const host = status.displayHost ?? status.host;
  if (!host || !status.port) return null;
  return `${status.secure ? "https" : "http"}://${urlHost(host)}:${status.port}`;
}

export function formatBrainStatusVram(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

export function buildBrainStatusDetails(
  brain: MutableBrainConfig,
  status: BrainHostStatus | null,
): Array<{ title: string; value: string }> {
  const details = [{ title: "Configured endpoint", value: formatConfiguredBrainEndpoint(brain) }];
  if (!status) return details;

  const detectedEndpoint = formatDetectedBrainEndpoint(status);
  if (detectedEndpoint) details.push({ title: "Detected endpoint", value: detectedEndpoint });
  if (status.version) details.push({ title: "Version", value: status.version });
  if (status.state) details.push({ title: "State", value: status.state });
  const model = status.model ?? status.modelId;
  if (model) details.push({ title: "Model", value: model });
  const vram = formatBrainStatusVram(status.vramBytes);
  if (vram) details.push({ title: "VRAM", value: vram });
  return details;
}

export function resolveBrainConnectionPhase({
  brain,
  status,
  hostConnected,
  loading,
  failed,
}: {
  brain: MutableBrainConfig;
  status: BrainHostStatus | null;
  hostConnected: boolean;
  loading: boolean;
  failed: boolean;
}): BrainConnectionPhase {
  if (!brain.enabled) return "disabled";
  if (!hostConnected || failed) return "unreachable";
  if (loading && !status) return "checking";
  if (status?.running) return status.state === "starting" ? "starting" : "connected";
  if (status?.state === "starting") return "starting";
  if (status?.state === "failed" || status?.lastError) return "unreachable";
  return brain.mode === "remote" ? "unreachable" : "stopped";
}
