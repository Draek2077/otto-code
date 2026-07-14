import { describe, expect, test } from "vitest";

import {
  composeRoleFocusDirective,
  personalityCanLaunch,
  summarizePersonalityForSelection,
} from "./agent-personalities.js";

describe("personality role tiers", () => {
  test("a personality with a coordinator role can launch", () => {
    expect(personalityCanLaunch({ roles: ["chatter"] })).toBe(true);
    expect(personalityCanLaunch({ roles: ["advisor"] })).toBe(true);
    expect(personalityCanLaunch({ roles: ["orchestrator"] })).toBe(true);
    expect(personalityCanLaunch({ roles: ["artificer"] })).toBe(true);
    expect(personalityCanLaunch({ roles: ["scheduler"] })).toBe(true);
  });

  test("a personality whose roles are entirely focused cannot launch", () => {
    expect(personalityCanLaunch({ roles: ["writer"] })).toBe(false);
    expect(personalityCanLaunch({ roles: ["coder"] })).toBe(false);
    expect(personalityCanLaunch({ roles: ["judger"] })).toBe(false);
    expect(personalityCanLaunch({ roles: ["writer", "coder", "judger"] })).toBe(false);
  });

  test("any coordinator role in a mixed set makes it a coordinator", () => {
    // Sprocket-style chatter+coder both codes and delegates.
    expect(personalityCanLaunch({ roles: ["coder", "chatter"] })).toBe(true);
    expect(summarizePersonalityForSelection({ roles: ["coder", "chatter"] }).tier).toBe(
      "coordinator",
    );
  });

  test("the retired worker alias resolves to focused coder", () => {
    expect(personalityCanLaunch({ roles: ["worker"] })).toBe(false);
  });

  test("a roleless personality defaults to focused and cannot launch", () => {
    expect(personalityCanLaunch({ roles: [] })).toBe(false);
    expect(summarizePersonalityForSelection({ roles: undefined }).tier).toBe("focused");
  });
});

describe("summarizePersonalityForSelection", () => {
  test("joins per-role guidance into one blurb", () => {
    const summary = summarizePersonalityForSelection({ roles: ["judger"] });
    expect(summary.canLaunch).toBe(false);
    expect(summary.tier).toBe("focused");
    expect(summary.guidance).toContain("Review specialist");
  });
});

describe("composeRoleFocusDirective", () => {
  test("coordinators are told orchestration is theirs", () => {
    const directive = composeRoleFocusDirective(["advisor"]);
    expect(directive).toContain("coordinator");
    expect(directive).toContain("spawn other agents");
  });

  test("focused workers are told to stay on task", () => {
    const directive = composeRoleFocusDirective(["coder"]);
    expect(directive).toContain("focused worker");
    expect(directive).toContain("stay on it");
    expect(directive).toContain("don't spawn sub-agents");
  });

  test("roleless spawns get no directive", () => {
    expect(composeRoleFocusDirective(undefined)).toBeUndefined();
    expect(composeRoleFocusDirective([])).toBeUndefined();
  });
});
