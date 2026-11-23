import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import { createElectronWakeWordDetector } from "./electron";
import type { WakeWordCapability } from "./bridge";
import type { WakeWordDetector } from "./controller";
export async function readWakeCapability(): Promise<WakeWordCapability> {
  if (!isElectronRuntime())
    return {
      available: false,
      safePhraseSupported: false,
      reason: "Hey Otto uses a device-local detector. Plain browsers do not support it.",
    };
  const bridge = getDesktopHost()?.wakeWord;
  // COMPAT(ottoWakeWordDesktop): v0.10.0, remove after 2027-04-30 once the desktop floor includes the local bridge.
  if (!bridge)
    return {
      available: false,
      safePhraseSupported: false,
      reason: "Update the desktop app to use Hey Otto.",
    };
  return bridge.capabilities();
}
export function createWakeWordDetector(): WakeWordDetector {
  return createElectronWakeWordDetector();
}
