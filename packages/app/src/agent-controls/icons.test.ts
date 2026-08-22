import { describe, expect, it } from "vitest";
import {
  LocalPolice,
  PrivacyTip,
  ShieldPerson,
  ShieldQuestionMark,
  ShieldToggle,
} from "@/components/icons/material-icons";
import type { AgentProviderDefinition } from "@otto-code/protocol/provider-manifest";
import { getAgentModeIcon, getAgentModeOptionIcon } from "./icons";

const CLAUDE_DEFINITION: AgentProviderDefinition = {
  id: "claude",
  label: "Claude",
  description: "",
  defaultModeId: "default",
  modes: [
    {
      id: "acceptEdits",
      label: "Accept File Edits",
      description: "",
      icon: "ShieldPerson",
      colorTier: "safe",
    },
    {
      id: "plan",
      label: "Plan Mode",
      description: "",
      icon: "ShieldToggle",
      colorTier: "planning",
    },
    {
      id: "auto",
      label: "Auto mode",
      description: "",
      icon: "LocalPolice",
      colorTier: "moderate",
    },
    {
      id: "bypassPermissions",
      label: "Bypass",
      description: "",
      icon: "PrivacyTip",
      colorTier: "dangerous",
    },
  ],
};

describe("agent mode icons", () => {
  it("keeps Otto's established Material Symbols for permission modes", () => {
    const definitions = [CLAUDE_DEFINITION];

    expect(getAgentModeIcon("claude", "acceptEdits", definitions)).toBe(ShieldPerson);
    expect(getAgentModeOptionIcon("claude", "plan", definitions)).toBe(ShieldToggle);
    expect(getAgentModeOptionIcon("claude", "auto", definitions)).toBe(LocalPolice);
    expect(getAgentModeOptionIcon("claude", "bypassPermissions", definitions)).toBe(PrivacyTip);
  });

  it("uses a neutral shield for unknown mode metadata", () => {
    expect(getAgentModeOptionIcon("unknown", "unknown", [])).toBe(ShieldQuestionMark);
  });
});
