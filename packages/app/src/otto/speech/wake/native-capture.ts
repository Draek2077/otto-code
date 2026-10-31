interface NativeCapturePort {
  startWakeWordDictation(): boolean;
  startDictation(): boolean;
  toggleRecording(enabled: boolean): boolean;
}
/** An expired wake event has no manual-capture fallback. The native claimant
 * verifies the pending token, foreground activity and existing AudioRecord.
 */
export function startNativeCapture(
  native: NativeCapturePort,
  mode: "conversation" | "dictation" | undefined,
  wakeHandoff: boolean,
) {
  if (wakeHandoff) {
    if (!native.startWakeWordDictation())
      throw new Error(
        "The Hey Otto command expired before dictation could claim it. Pause and resume listening to retry.",
      );
    return true;
  }
  return mode === "dictation" ? native.startDictation() : native.toggleRecording(true);
}
