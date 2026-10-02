/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  behavior: undefined as "interrupt" | "steer" | "queue" | undefined,
  localBehavior: "queue" as "interrupt" | "steer" | "queue",
  supportsDefaultSend: true,
  patchConfig: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({
    settings: { sendBehavior: host.localBehavior },
    isLoading: false,
    updateSettings: host.updateSettings,
  }),
}));
vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: { agentBehaviors: { defaultSendBehavior: host.behavior } },
    patchConfig: host.patchConfig,
  }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => true,
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "host-with-choice": {
          serverInfo: { features: { agentToAgentDefaultSend: host.supportsDefaultSend } },
        },
        "host-to-migrate": {
          serverInfo: { features: { agentToAgentDefaultSend: host.supportsDefaultSend } },
        },
      },
    }),
}));

import { useDefaultSendBehavior } from "./use-default-send-behavior";

beforeEach(() => {
  host.behavior = undefined;
  host.localBehavior = "queue";
  host.supportsDefaultSend = true;
  host.patchConfig.mockReset();
  host.updateSettings.mockReset();
  host.patchConfig.mockResolvedValue({ agentBehaviors: { defaultSendBehavior: "queue" } });
  host.updateSettings.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("useDefaultSendBehavior", () => {
  it("shows the stored host choice and saves a new choice to both host and device", async () => {
    host.behavior = "interrupt";
    const { result } = renderHook(() => useDefaultSendBehavior("host-with-choice"));
    expect(result.current.behavior).toBe("interrupt");
    expect(host.patchConfig).not.toHaveBeenCalled();

    await act(async () => result.current.setBehavior("steer"));
    expect(host.patchConfig).toHaveBeenCalledWith({
      agentBehaviors: { defaultSendBehavior: "steer" },
    });
    expect(host.updateSettings).toHaveBeenCalledWith({ sendBehavior: "steer" });
  });

  it("seeds a new host before applying a user selection made during migration", async () => {
    let finishMigration!: (value: unknown) => void;
    host.patchConfig.mockImplementationOnce(
      () => new Promise((resolve) => (finishMigration = resolve)),
    );
    const { result } = renderHook(() => useDefaultSendBehavior("host-to-migrate"));
    expect(result.current.behavior).toBe("queue");
    expect(host.patchConfig).toHaveBeenCalledWith({
      agentBehaviors: { defaultSendBehavior: "queue" },
    });

    let selection!: Promise<void>;
    act(() => {
      selection = result.current.setBehavior("interrupt");
    });
    expect(host.patchConfig).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishMigration({ agentBehaviors: { defaultSendBehavior: "queue" } });
      await selection;
    });
    await waitFor(() => expect(host.patchConfig).toHaveBeenCalledTimes(2));
    expect(host.patchConfig).toHaveBeenNthCalledWith(2, {
      agentBehaviors: { defaultSendBehavior: "interrupt" },
    });
    expect(host.updateSettings).toHaveBeenCalledWith({ sendBehavior: "interrupt" });
  });

  it("keeps the selected behavior when the host rejects a change", async () => {
    host.behavior = "interrupt";
    host.patchConfig.mockRejectedValueOnce(new Error("Host update failed"));
    const { result } = renderHook(() => useDefaultSendBehavior("host-with-choice"));

    await expect(result.current.setBehavior("steer")).rejects.toThrow("Host update failed");
    expect(result.current.behavior).toBe("interrupt");
    expect(host.updateSettings).not.toHaveBeenCalled();
  });

  it("keeps the device preference for a host without the new capability", async () => {
    host.behavior = "interrupt";
    host.supportsDefaultSend = false;
    const { result } = renderHook(() => useDefaultSendBehavior("host-with-choice"));
    expect(result.current.behavior).toBe("queue");
    expect(host.patchConfig).not.toHaveBeenCalled();

    await act(async () => result.current.setBehavior("steer"));
    expect(host.patchConfig).not.toHaveBeenCalled();
    expect(host.updateSettings).toHaveBeenCalledWith({ sendBehavior: "steer" });
  });
});
