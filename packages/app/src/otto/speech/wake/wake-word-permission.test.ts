import { describe, expect, it, vi } from "vitest";

import { ensureWakeWordMicrophonePermission } from "./wake-word-permission";

describe("ensureWakeWordMicrophonePermission", () => {
  it("starts without prompting when microphone access is already granted", async () => {
    const request = vi.fn();

    await ensureWakeWordMicrophonePermission({
      getMicrophonePermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
      requestMicrophonePermissionsAsync: request,
    });

    expect(request).not.toHaveBeenCalled();
  });

  it("requests microphone access before starting when needed", async () => {
    const request = vi.fn().mockResolvedValue({ granted: true });

    await ensureWakeWordMicrophonePermission({
      getMicrophonePermissionsAsync: vi.fn().mockResolvedValue({ granted: false }),
      requestMicrophonePermissionsAsync: request,
    });

    expect(request).toHaveBeenCalledOnce();
  });

  it("reports a clear error when microphone access is rejected", async () => {
    await expect(
      ensureWakeWordMicrophonePermission({
        getMicrophonePermissionsAsync: vi.fn().mockResolvedValue({ granted: false }),
        requestMicrophonePermissionsAsync: vi.fn().mockResolvedValue({ granted: false }),
      }),
    ).rejects.toThrow("Microphone access is required for Hey Otto");
  });
});
