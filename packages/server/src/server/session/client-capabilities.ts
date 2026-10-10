import { BrowserAutomationHostCapabilitySchema } from "@otto-code/protocol/browser-automation/capabilities";
import { CLIENT_CAPS, type ClientCapability } from "@otto-code/protocol/client-capabilities";

// Reads the capability record a client sends on hello / capability updates.

export function parseClientCapabilities(
  capabilities: Record<string, unknown> | null | undefined,
): ReadonlySet<ClientCapability> {
  if (!capabilities) {
    return new Set();
  }
  const known = new Set<ClientCapability>(Object.values(CLIENT_CAPS));
  const result: ClientCapability[] = [];
  for (const [key, value] of Object.entries(capabilities)) {
    if (value === true && known.has(key as ClientCapability)) {
      result.push(key as ClientCapability);
    }
  }
  return new Set(result);
}

export function hasBrowserHostCapability(
  capabilities: Record<string, unknown> | null | undefined,
): boolean {
  // browser_host is a structured capability, so parseClientCapabilities' boolean
  // set cannot identify the desktop app that actually owns a native webview.
  return BrowserAutomationHostCapabilitySchema.safeParse(capabilities?.[CLIENT_CAPS.browserHost])
    .success;
}
