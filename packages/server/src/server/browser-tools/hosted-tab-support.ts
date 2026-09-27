import type { BrowserAutomationHostCapability } from "@otto-code/protocol/browser-automation/capabilities";

// COMPAT(hostedTabsCapability): added in v0.9.26, remove after 2027-03-28.
// 0.9.25 shows hosted tabs but shipped before the capability existed.
const FIRST_VERSION_SHOWING_HOSTED_TABS = [0, 9, 25] as const;

function isAtLeast(version: string, floor: readonly number[]): boolean {
  const parts = version.split("-")[0]!.split(".").map(Number);
  if (parts.length < floor.length || parts.some((part) => !Number.isInteger(part))) return false;
  for (const [index, wanted] of floor.entries()) {
    if (parts[index]! !== wanted) return parts[index]! > wanted;
  }
  return true;
}

/** Whether a desktop app projects daemon-hosted tabs into its own tab strip. */
export function appShowsHostedTabs(
  capability: BrowserAutomationHostCapability,
  appVersion: string | null,
): boolean {
  if (capability.hostedTabs !== undefined) return capability.hostedTabs;
  return appVersion !== null && isAtLeast(appVersion, FIRST_VERSION_SHOWING_HOSTED_TABS);
}
