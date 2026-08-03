import { describe, expect, test } from "vitest";

import { resolveModelPickExitModeId } from "./model-pick-mode.js";
import type { AgentMode } from "./agent-sdk-types.js";

// Mirrors Claude's live roster (see DEFAULT_MODES in providers/claude/agent.ts):
// Auto picks the model per turn, dontAsk is system-assigned and unattended.
function claudeModes(): AgentMode[] {
  return [
    { id: "default", label: "Always Ask" },
    { id: "acceptEdits", label: "Accept File Edits" },
    { id: "plan", label: "Plan Mode" },
    { id: "auto", label: "Auto mode", selectsModel: true },
    { id: "dontAsk", label: "Don't Ask", isUnattended: true },
    { id: "bypassPermissions", label: "Bypass", isUnattended: true },
  ];
}

describe("resolveModelPickExitModeId", () => {
  test("leaves Claude's Auto for the provider's declared default", () => {
    expect(
      resolveModelPickExitModeId({
        provider: "claude",
        currentModeId: "auto",
        availableModes: claudeModes(),
      }),
    ).toBe("default");
  });

  test("is a no-op for a mode that does not pick the model", () => {
    expect(
      resolveModelPickExitModeId({
        provider: "claude",
        currentModeId: "plan",
        availableModes: claudeModes(),
      }),
    ).toBeUndefined();
  });

  // Provider parity: Codex ships a mode whose id is literally "auto", and it is
  // a permission level that has nothing to do with model choice. The coercion
  // keys on the capability flag, so this must not move.
  test("does not touch a same-named mode on another provider", () => {
    expect(
      resolveModelPickExitModeId({
        provider: "codex",
        currentModeId: "auto",
        availableModes: [
          { id: "auto", label: "Default Permissions" },
          { id: "auto-review", label: "Auto-review" },
          { id: "full-access", label: "Full Access", isUnattended: true },
        ],
      }),
    ).toBeUndefined();
  });

  test("is a no-op for a provider with no modes at all", () => {
    expect(
      resolveModelPickExitModeId({
        provider: "pi",
        currentModeId: null,
        availableModes: [],
      }),
    ).toBeUndefined();
  });

  // An unattended run coerced INTO a model-selecting mode must not be dropped
  // into one that prompts, or it strands on the first approval. dontAsk is
  // unattended but userSelectable:false, so bypassPermissions is the only spot.
  test("keeps an unattended mode unattended and skips system-assigned modes", () => {
    const modes: AgentMode[] = [
      { id: "default", label: "Always Ask" },
      { id: "auto", label: "Auto mode", selectsModel: true, isUnattended: true },
      { id: "dontAsk", label: "Don't Ask", isUnattended: true },
      { id: "bypassPermissions", label: "Bypass", isUnattended: true },
    ];

    expect(
      resolveModelPickExitModeId({
        provider: "claude",
        currentModeId: "auto",
        availableModes: modes,
      }),
    ).toBe("bypassPermissions");
  });

  test("leaves the mode alone when nothing safe is available to land on", () => {
    expect(
      resolveModelPickExitModeId({
        provider: "claude",
        currentModeId: "auto",
        availableModes: [{ id: "auto", label: "Auto mode", selectsModel: true }],
      }),
    ).toBeUndefined();
  });

  test("is a no-op when the current mode is not in the roster", () => {
    expect(
      resolveModelPickExitModeId({
        provider: "claude",
        currentModeId: "ghost",
        availableModes: claudeModes(),
      }),
    ).toBeUndefined();
  });

  // Dynamic ACP rosters carry no manifest default, so the first safe candidate
  // in the provider's own order wins.
  test("falls back to the first safe mode when the manifest default is not on offer", () => {
    expect(
      resolveModelPickExitModeId({
        provider: "copilot",
        currentModeId: "router",
        availableModes: [
          { id: "router", label: "Router", selectsModel: true },
          { id: "agent", label: "Agent" },
          { id: "plan", label: "Plan" },
        ],
      }),
    ).toBe("agent");
  });
});
