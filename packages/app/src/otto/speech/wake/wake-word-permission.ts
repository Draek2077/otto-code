export interface WakeWordMicrophonePermissions {
  getMicrophonePermissionsAsync: () => Promise<{ granted: boolean }>;
  requestMicrophonePermissionsAsync: () => Promise<{ granted: boolean }>;
}

export async function ensureWakeWordMicrophonePermission(
  permissions: WakeWordMicrophonePermissions,
): Promise<void> {
  let response = await permissions.getMicrophonePermissionsAsync();
  if (!response.granted) {
    response = await permissions.requestMicrophonePermissionsAsync();
  }

  if (!response.granted) {
    throw new Error(
      "Microphone access is required for Hey Otto. Allow microphone access in system settings, then try again.",
    );
  }
}
