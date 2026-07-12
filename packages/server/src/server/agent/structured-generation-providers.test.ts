import { describe, expect, test } from "vitest";

import type { AgentPersonality } from "@otto-code/protocol/messages";
import {
  resolveStructuredGenerationAgent,
  resolveStructuredGenerationProviders,
} from "./structured-generation-providers.js";
import type { ProviderSnapshotEntry } from "./agent-sdk-types.js";

const READY = "ready" as const;
const ERROR = "error" as const;

class ProviderSnapshots {
  readonly calls: Array<{ cwd?: string; wait?: boolean }> = [];

  constructor(private readonly entries: ProviderSnapshotEntry[]) {}

  async listProviders(input: { cwd?: string; wait?: boolean } = {}) {
    this.calls.push({ cwd: input.cwd, wait: input.wait });
    return this.entries;
  }
}

function personality(overrides: Partial<AgentPersonality> = {}): AgentPersonality {
  return {
    id: "p-dash",
    name: "Dash",
    provider: "lmstudio",
    model: "qwen3-writer",
    effortLevel: "low",
    modeId: "auto",
    respectGlobalAppendPrompt: true,
    roles: ["writer"],
    spinner: { glowA: "#22C55E", glowB: "#A3E635" },
    ...overrides,
  };
}

describe("resolveStructuredGenerationProviders", () => {
  test("uses explicit configured provider models without refreshing provider snapshots", async () => {
    const snapshots = new ProviderSnapshots([]);

    const providers = await resolveStructuredGenerationProviders({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      daemonConfig: {
        metadataGeneration: {
          providers: [{ provider: "mock", model: "ten-second-stream" }],
        },
      },
    });

    expect(providers).toEqual([{ provider: "mock", model: "ten-second-stream" }]);
    expect(snapshots.calls).toEqual([]);
  });

  test("falls back to dynamic defaults and current selection when no provider is configured", async () => {
    const snapshots = new ProviderSnapshots([
      {
        provider: "work-claude",
        status: READY,
        enabled: true,
        models: [
          { provider: "work-claude", id: "claude-haiku-2026", label: "Haiku", isDefault: true },
        ],
      },
      {
        provider: "work-codex",
        status: READY,
        enabled: true,
        models: [
          {
            provider: "work-codex",
            id: "gpt-5.4-mini-2026",
            label: "GPT 5.4 Mini",
            isDefault: true,
            thinkingOptions: [
              { id: "low", label: "Low" },
              { id: "medium", label: "Medium", isDefault: true },
            ],
            defaultThinkingOptionId: "medium",
          },
        ],
      },
      {
        provider: "router",
        status: READY,
        enabled: true,
        models: [
          { provider: "router", id: "minimax-m3-free", label: "MiniMax M3", isDefault: true },
          { provider: "router", id: "nemotron-3-super-free", label: "Nemotron 3 Super" },
        ],
      },
    ]);

    const providers = await resolveStructuredGenerationProviders({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      currentSelection: {
        provider: "focused-provider",
        model: "focused-model",
        thinkingOptionId: "high",
      },
    });

    expect(providers).toEqual([
      { provider: "work-claude", model: "claude-haiku-2026" },
      { provider: "work-codex", model: "gpt-5.4-mini-2026", thinkingOptionId: "low" },
      { provider: "router", model: "minimax-m3-free" },
      { provider: "router", model: "nemotron-3-super-free" },
      { provider: "focused-provider", model: "focused-model", thinkingOptionId: "high" },
    ]);
    expect(snapshots.calls).toEqual([{ cwd: "/tmp/repo", wait: true }]);
  });

  test("falls back to the current selection when defaults do not match", async () => {
    const snapshots = new ProviderSnapshots([
      {
        provider: "current-provider",
        status: READY,
        enabled: true,
        models: [
          {
            provider: "current-provider",
            id: "selected-model",
            label: "Selected Model",
            isDefault: true,
          },
        ],
      },
    ]);

    const providers = await resolveStructuredGenerationProviders({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      currentSelection: {
        provider: "current-provider",
        model: "selected-model",
        thinkingOptionId: "medium",
      },
    });

    expect(providers).toEqual([
      { provider: "current-provider", model: "selected-model", thinkingOptionId: "medium" },
    ]);
  });

  test("resolves a provider-only current selection to that provider's default model", async () => {
    const snapshots = new ProviderSnapshots([
      {
        provider: "focused-provider",
        status: READY,
        enabled: true,
        models: [
          {
            provider: "focused-provider",
            id: "focused-default",
            label: "Focused Default",
            isDefault: true,
            defaultThinkingOptionId: "balanced",
          },
        ],
      },
    ]);

    const providers = await resolveStructuredGenerationProviders({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      currentSelection: { provider: "focused-provider" },
    });

    expect(providers).toEqual([
      { provider: "focused-provider", model: "focused-default", thinkingOptionId: "balanced" },
    ]);
  });

  test("uses explicit configured provider models as-is instead of waiting to normalize aliases", async () => {
    const snapshots = new ProviderSnapshots([
      {
        provider: "opencode",
        status: READY,
        enabled: true,
        models: [
          {
            provider: "opencode",
            id: "plexus/small-fast",
            label: "Small Fast",
            isDefault: true,
            metadata: {
              providerId: "plexus",
              modelId: "small-fast",
            },
          },
        ],
      },
    ]);

    const providers = await resolveStructuredGenerationProviders({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      daemonConfig: {
        metadataGeneration: {
          providers: [{ provider: "plexus", model: "small-fast" }],
        },
      },
    });

    expect(providers).toEqual([{ provider: "plexus", model: "small-fast" }]);
    expect(snapshots.calls).toEqual([]);
  });

  test("keeps explicit candidates when provider snapshots are in error state", async () => {
    const snapshots = new ProviderSnapshots([
      {
        provider: "current-provider",
        status: ERROR,
        enabled: true,
        error: "timed out",
      },
    ]);

    const providers = await resolveStructuredGenerationProviders({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      daemonConfig: {
        metadataGeneration: {
          providers: [{ provider: "current-provider", model: "configured-model" }],
        },
      },
      currentSelection: {
        provider: "current-provider",
        model: "selected-model",
        thinkingOptionId: "medium",
      },
    });

    expect(providers).toEqual([{ provider: "current-provider", model: "configured-model" }]);
    expect(snapshots.calls).toEqual([]);
  });

  test("prepends an available role-matched personality ahead of the legacy chain", async () => {
    const snapshots = new ProviderSnapshots([
      {
        provider: "lmstudio",
        status: READY,
        enabled: true,
        models: [
          {
            provider: "lmstudio",
            id: "qwen3-writer",
            label: "Qwen3 Writer",
            thinkingOptions: [
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
          },
        ],
        modes: [{ id: "auto", label: "Auto" }],
      },
      {
        provider: "work-claude",
        status: READY,
        enabled: true,
        models: [
          { provider: "work-claude", id: "claude-haiku-2026", label: "Haiku", isDefault: true },
        ],
      },
    ]);

    const providers = await resolveStructuredGenerationProviders({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      role: "writer",
      daemonConfig: {
        agentPersonalities: { personalities: [personality({ roles: ["writer", "scheduler"] })] },
      },
    });

    // Writer personality first — its canonical "low" effort resolves to the
    // model's "low" option — then the built-in "haiku" substring default behind it.
    expect(providers).toEqual([
      { provider: "lmstudio", model: "qwen3-writer", thinkingOptionId: "low" },
      { provider: "work-claude", model: "claude-haiku-2026" },
    ]);
    expect(snapshots.calls).toEqual([{ cwd: "/tmp/repo", wait: true }]);
  });

  test("skips an out-of-commission personality and falls back to the legacy chain", async () => {
    const snapshots = new ProviderSnapshots([
      {
        provider: "work-claude",
        status: READY,
        enabled: true,
        models: [
          { provider: "work-claude", id: "claude-haiku-2026", label: "Haiku", isDefault: true },
        ],
      },
    ]);

    const providers = await resolveStructuredGenerationProviders({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      role: "writer",
      daemonConfig: {
        // Bound to a provider that isn't in the snapshot → provider-missing.
        agentPersonalities: { personalities: [personality({ provider: "not-connected" })] },
      },
    });

    expect(providers).toEqual([{ provider: "work-claude", model: "claude-haiku-2026" }]);
  });

  test("ignores personalities that lack the requested role", async () => {
    const snapshots = new ProviderSnapshots([
      {
        provider: "lmstudio",
        status: READY,
        enabled: true,
        models: [{ provider: "lmstudio", id: "coder-model", label: "Coder" }],
      },
    ]);

    const providers = await resolveStructuredGenerationProviders({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      role: "writer",
      daemonConfig: {
        agentPersonalities: {
          personalities: [personality({ model: "coder-model", roles: ["coder"] })],
        },
      },
    });

    // No writer personality, no substring match, no current selection.
    expect(providers).toEqual([]);
  });

  test("routes a legacy 'worker'-tagged personality to the coder role", async () => {
    const snapshots = new ProviderSnapshots([
      {
        provider: "lmstudio",
        status: READY,
        enabled: true,
        models: [{ provider: "lmstudio", id: "impl-model", label: "Impl" }],
        modes: [{ id: "auto", label: "Auto" }],
      },
    ]);

    const providers = await resolveStructuredGenerationProviders({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      role: "coder",
      daemonConfig: {
        agentPersonalities: {
          personalities: [
            personality({ model: "impl-model", effortLevel: "high", roles: ["worker"] }),
          ],
        },
      },
    });

    // "worker" normalizes to "coder", so this legacy personality still matches;
    // the model advertises no thinking options, so effort is left unset.
    expect(providers).toEqual([{ provider: "lmstudio", model: "impl-model" }]);
  });
});

describe("resolveStructuredGenerationAgent", () => {
  test("names the winning writer personality with its provider/model labels", async () => {
    const snapshots = new ProviderSnapshots([
      {
        provider: "lmstudio",
        status: READY,
        enabled: true,
        label: "LM Studio",
        models: [
          { provider: "lmstudio", id: "qwen3-writer", label: "Qwen3 Writer", isDefault: true },
        ],
        modes: [{ id: "auto", label: "Auto" }],
      },
    ]);

    const agent = await resolveStructuredGenerationAgent({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      role: "writer",
      daemonConfig: { agentPersonalities: { personalities: [personality()] } },
    });

    expect(agent).toEqual({
      kind: "personality",
      personalityId: "p-dash",
      personalityName: "Dash",
      provider: "lmstudio",
      providerLabel: "LM Studio",
      model: "qwen3-writer",
      modelLabel: "Qwen3 Writer",
    });
  });

  test("falls back to a bare provider/model when no personality matches", async () => {
    const snapshots = new ProviderSnapshots([
      {
        provider: "work-claude",
        status: READY,
        enabled: true,
        label: "Claude Code",
        models: [
          { provider: "work-claude", id: "claude-haiku-2026", label: "Haiku", isDefault: true },
        ],
      },
    ]);

    const agent = await resolveStructuredGenerationAgent({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      role: "writer",
    });

    expect(agent).toEqual({
      kind: "provider",
      provider: "work-claude",
      providerLabel: "Claude Code",
      model: "claude-haiku-2026",
      modelLabel: "Haiku",
    });
  });

  test("returns null when nothing resolves", async () => {
    const snapshots = new ProviderSnapshots([
      { provider: "work-claude", status: ERROR, enabled: false },
    ]);

    const agent = await resolveStructuredGenerationAgent({
      cwd: "/tmp/repo",
      providerSnapshotManager: snapshots,
      role: "writer",
    });

    expect(agent).toBeNull();
  });
});
