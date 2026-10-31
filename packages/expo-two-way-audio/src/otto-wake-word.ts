import Native from "./ExpoTwoWayAudioModule";
export interface WakeWordCapabilities {
  available: boolean;
  safePhraseSupported: boolean;
  modelVersion?: string;
  reason?: string;
}
// COMPAT(ottoWakeWord): v0.10.0, remove the binary capability gate after 2027-04-30 once the native floor includes it.
export function getWakeWordCapabilities(): WakeWordCapabilities {
  if (
    typeof Native.getWakeWordCapabilities !== "function" ||
    typeof Native.startWakeWordDictation !== "function"
  ) {
    return {
      available: false,
      safePhraseSupported: false,
      reason: "This platform does not include the native Hey Otto detector.",
    };
  }
  return Native.getWakeWordCapabilities();
}
export async function startWakeWordDetection(phrase: string, sensitivity: number): Promise<void> {
  if (!getWakeWordCapabilities().available)
    throw new Error("Hey Otto requires an updated native detector build.");
  await Native.startWakeWordDetection(phrase, sensitivity);
}
export async function stopWakeWordDetection(discardHandoff = true): Promise<void> {
  if (typeof Native.stopWakeWordDetection === "function")
    await Native.stopWakeWordDetection(discardHandoff);
}
export function startWakeWordDictation(): boolean {
  if (typeof Native.startWakeWordDictation !== "function")
    throw new Error("Update the app to use the native wake-word handoff.");
  return Native.startWakeWordDictation();
}
