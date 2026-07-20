import type { DaemonConfigStore, MutableDaemonConfig } from "../daemon-config-store.js";

export interface BrowserToolsPolicy {
  isEnabled(): boolean;
}

export class DaemonConfigBrowserToolsPolicy implements BrowserToolsPolicy {
  public constructor(private readonly configStore: Pick<DaemonConfigStore, "get">) {}

  public isEnabled(): boolean {
    return readBrowserToolsEnabled(this.configStore.get());
  }
}

function readBrowserToolsEnabled(config: MutableDaemonConfig): boolean {
  const browserTools = config.browserTools;
  // Strict: anything other than an explicit `true` is off. Browser tools are an
  // opt-in, so an absent or malformed section must never read as enabled.
  if (typeof browserTools !== "object" || browserTools === null || Array.isArray(browserTools)) {
    return false;
  }
  return browserTools.enabled === true;
}
