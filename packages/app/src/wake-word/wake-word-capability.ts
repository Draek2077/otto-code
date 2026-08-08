import { getIsElectron, isNative } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";

export interface WakeWordCapability {
  available: boolean;
  safePhraseSupported: boolean;
  reason?: string;
}

/** Capability is local to the installed app, never a daemon/provider feature. */
export function getWakeWordCapability(): WakeWordCapability {
  if (getIsElectron()) {
    if (typeof getDesktopHost()?.wakeWord?.start !== "function") {
      return {
        available: false,
        safePhraseSupported: false,
        reason: "This desktop build does not expose the local wake-word bridge.",
      };
    }
    // The desktop model is checked when the detector starts because capability
    // discovery is synchronous in the settings/UI path. A missing model is an
    // installation error, not a permission or provider fallback.
    return { available: true, safePhraseSupported: true };
  }

  if (!isNative) {
    return {
      available: false,
      safePhraseSupported: false,
      reason: "Hey Otto requires a native on-device detector; browser builds are unsupported.",
    };
  }

  try {
    const native = require("@otto-code/expo-two-way-audio") as {
      getWakeWordCapabilities?: () => WakeWordCapability;
    };
    const capability = native.getWakeWordCapabilities?.();
    if (capability?.available === true) return capability;
  } catch {
    // Missing native module is an unsupported capability, not a reason to
    // request microphone permission or fall back to browser audio.
  }
  return {
    available: false,
    safePhraseSupported: false,
    reason: "This build does not include a native wake-word model.",
  };
}
