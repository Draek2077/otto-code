import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import { DaemonConfigStore } from "../daemon-config-store.js";
import { attachBrainConfigOwner } from "./brain-config-owner.js";

function mutableConfig(): MutableDaemonConfig {
  return {
    relay: { enabled: false },
    mcp: { enabled: true, injectIntoAgents: false },
    browserTools: { enabled: false },
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
    cors: { allowedOrigins: [] },
    trustedProxies: ["loopback"],
    git: { maxProcessesPerSecond: 64, maxProcessConcurrency: 8 },
    app: { baseUrl: "https://app.otto-code.me" },
  };
}

describe("Brain config owner", () => {
  test("applies session changes to the running manager in order", async () => {
    const ottoHome = mkdtempSync(path.join(tmpdir(), "otto-brain-config-owner-"));
    try {
      const store = new DaemonConfigStore(ottoHome, mutableConfig());
      let releaseInitial!: () => void;
      const initial = new Promise<void>((resolve) => {
        releaseInitial = resolve;
      });
      const applied: boolean[] = [];
      const applySettings = vi.fn(async (brain: MutableDaemonConfig["brain"]) => {
        if (applied.length === 0) await initial;
        applied.push(brain.enabled);
      });
      const onError = vi.fn();
      const unsubscribe = attachBrainConfigOwner({
        store,
        manager: { applySettings },
        onError,
      });
      try {
        store.patch({ brain: { enabled: true } });
        store.patch({ brain: { enabled: false } });
        releaseInitial();
        await vi.waitFor(() => expect(applied).toEqual([false, true, false]));
        expect(onError).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
      }
    } finally {
      rmSync(ottoHome, { recursive: true, force: true });
    }
  });
});
